package handler

import (
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/gorilla/mux"
)

// ClickRecorder takes note of a redirect without making the visitor wait for it.
type ClickRecorder interface {
	Record(c analytics.Click)
}

type LinkHandler struct {
	links   *link.Service
	clicks  ClickRecorder // nil records nothing
	baseURL string        // public URL short links are served from
	// trustProxy reads the visitor's address from X-Forwarded-For; see clientIP.
	trustProxy bool
}

func NewLinkHandler(links *link.Service, clicks ClickRecorder, baseURL string, trustProxy bool) *LinkHandler {
	return &LinkHandler{links: links, clicks: clicks, baseURL: strings.TrimRight(baseURL, "/"), trustProxy: trustProxy}
}

type linkBody struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	ShortURL  string  `json:"short_url"`
	OriginURL string  `json:"origin_url"`
	ExpiresAt *string `json:"expires_at"`
	MaxClicks *int64  `json:"max_clicks"`
	Protected bool    `json:"protected"`
	CreatedAt string  `json:"created_at"`
}

// Create shortens a URL for the organization the Tenant middleware already checked: a JWT
// caller belongs to it, an API key was issued for it.
func (h *LinkHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in struct {
		URL       string     `json:"url"`
		ExpiresAt *time.Time `json:"expires_at"`
		Alias     string     `json:"alias"`
		MaxClicks *int64     `json:"max_clicks"`
		Password  string     `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	l, err := h.links.Shorten(r.Context(), link.ShortenInput{
		TenantID: tenant.ID, UserID: PrincipalFrom(r).UserID,
		URL: in.URL, Alias: in.Alias, ExpiresAt: in.ExpiresAt, MaxClicks: in.MaxClicks, Password: in.Password,
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, h.body(l))
}

func (h *LinkHandler) body(l link.Link) linkBody {
	return linkBody{
		ID: l.ID, Code: l.Code, ShortURL: h.baseURL + "/" + l.Code, OriginURL: l.OriginURL,
		ExpiresAt: formatTimePtr(l.ExpiresAt), MaxClicks: l.MaxClicks, Protected: l.Protected(), CreatedAt: formatTime(l.CreatedAt),
	}
}

// List answers one page of the organization's links, newest first.
func (h *LinkHandler) List(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	list, total, err := h.links.List(r.Context(), tenant.ID, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]linkBody, 0, len(list))
	for _, l := range list {
		out = append(out, h.body(l))
	}
	writePage(w, out, p, total)
}

// Delete removes a link of the organization; one of another organization is a 404.
func (h *LinkHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := idParam(w, r, "linkID")
	if !ok {
		return
	}
	if err := h.links.Delete(r.Context(), tenant.ID, linkID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unlockBodyLimit bounds an unlock request: a password is at most 64 characters.
const unlockBodyLimit = 4 << 10

// Unlock checks the password of a protected link: 302 to the link when right, 401 when wrong and
// 429 after too many tries. The password comes from an HTML form (password=...) or from JSON
// ({"password": "..."}).
func (h *LinkHandler) Unlock(w http.ResponseWriter, r *http.Request) {
	password, ok := readPassword(w, r)
	if !ok {
		return
	}
	ip := clientIP(r, h.trustProxy)
	l, err := h.links.Unlock(r.Context(), mux.Vars(r)["code"], password, ip.String())
	if err != nil {
		WriteError(w, r, err)
		return
	}
	if h.clicks != nil {
		// The Referer of this request is the unlock page itself, so it says nothing about the visitor.
		h.clicks.Record(analytics.Click{LinkID: l.ID, UserAgent: r.UserAgent(), IP: ip})
	}
	http.Redirect(w, r, l.OriginURL, http.StatusFound)
}

// readPassword takes the password from a form or a JSON body, bounded in size. On failure it has
// already answered.
func readPassword(w http.ResponseWriter, r *http.Request) (string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, unlockBodyLimit)
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "application/json" {
		var in struct {
			Password string `json:"password"`
		}
		if !decode(w, r, &in) {
			return "", false
		}
		return in.Password, true
	}
	if err := r.ParseForm(); err != nil {
		WriteAPIError(w, http.StatusBadRequest, "invalid_body", "the request body is not a valid form")
		return "", false
	}
	return r.PostForm.Get("password"), true
}

// Redirect answers 302 (not 301) so every click reaches the server.
func (h *LinkHandler) Redirect(w http.ResponseWriter, r *http.Request) {
	l, err := h.links.Resolve(r.Context(), mux.Vars(r)["code"])
	if err != nil {
		WriteError(w, r, err)
		return
	}
	if h.clicks != nil {
		h.clicks.Record(analytics.Click{
			LinkID: l.ID, Referrer: r.Referer(), UserAgent: r.UserAgent(), IP: clientIP(r, h.trustProxy),
		})
	}
	http.Redirect(w, r, l.OriginURL, http.StatusFound)
}
