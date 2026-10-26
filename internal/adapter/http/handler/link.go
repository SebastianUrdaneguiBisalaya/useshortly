package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/gorilla/mux"
)

type LinkHandler struct {
	links   *link.Service
	baseURL string // public URL short links are served from
}

func NewLinkHandler(links *link.Service, baseURL string) *LinkHandler {
	return &LinkHandler{links: links, baseURL: strings.TrimRight(baseURL, "/")}
}

type linkBody struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	ShortURL  string  `json:"short_url"`
	OriginURL string  `json:"origin_url"`
	ExpiresAt *string `json:"expires_at"`
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
	}
	if !decode(w, r, &in) {
		return
	}
	l, err := h.links.Shorten(r.Context(), tenant.ID, PrincipalFrom(r).UserID, in.URL, in.Alias, in.ExpiresAt)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, linkBody{
		ID: l.ID, Code: l.Code, ShortURL: h.baseURL + "/" + l.Code, OriginURL: l.OriginURL,
		ExpiresAt: formatTimePtr(l.ExpiresAt), CreatedAt: formatTime(l.CreatedAt),
	})
}

// Redirect answers 302 (not 301) so every click reaches the server.
func (h *LinkHandler) Redirect(w http.ResponseWriter, r *http.Request) {
	target, err := h.links.Resolve(r.Context(), mux.Vars(r)["code"])
	if err != nil {
		WriteError(w, r, err)
		return
	}
	http.Redirect(w, r, target, http.StatusFound)
}
