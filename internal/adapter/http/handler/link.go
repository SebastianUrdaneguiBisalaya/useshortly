package handler

import (
	"context"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/gorilla/mux"
)

// ClickRecorder takes note of a redirect without making the visitor wait for it.
type ClickRecorder interface {
	Record(c analytics.Click)
}

// DomainFinder finds the verified custom domain that serves a host.
type DomainFinder interface {
	// FindVerified returns domain.ErrNotFound for an unknown or unverified host.
	FindVerified(ctx context.Context, host string) (domain.Domain, error)
}

type LinkHandler struct {
	links   *link.Service
	clicks  ClickRecorder // nil records nothing
	baseURL string        // public URL short links are served from
	// trustProxy reads the visitor's address from X-Forwarded-For; see clientIP.
	trustProxy bool
	pages      UnlockPages  // nil shows the default unlock page
	orgs       OrgNames     // names the organization in the unlock page footer
	abuseEmail string       // where visitors report a link; empty shows no report link
	domains    DomainFinder // nil serves every host as the default one
}

func NewLinkHandler(links *link.Service, clicks ClickRecorder, baseURL string, trustProxy bool) *LinkHandler {
	return &LinkHandler{links: links, clicks: clicks, baseURL: strings.TrimRight(baseURL, "/"), trustProxy: trustProxy}
}

// WithDomains serves links of custom domains: the Host of a request picks the domain whose links
// are looked up. Unknown hosts, and the instance's own, use the default links.
func (h *LinkHandler) WithDomains(d DomainFinder) *LinkHandler {
	h.domains = d
	return h
}

// shortURL is the public address of a link: its domain's host if it has one, else the instance's.
func shortURL(baseURL string, l link.Link) string {
	if l.DomainHost == "" {
		return baseURL + "/" + l.Code
	}
	scheme := "https"
	if u, err := url.Parse(baseURL); err == nil && u.Scheme != "" {
		scheme = u.Scheme
	}
	return scheme + "://" + l.DomainHost + "/" + l.Code
}

// domainID is the custom domain the request was made to, or nil for the default host.
func (h *LinkHandler) domainID(r *http.Request) (*int64, error) {
	if h.domains == nil {
		return nil, nil
	}
	host := r.Host
	if hostOnly, _, err := net.SplitHostPort(host); err == nil {
		host = hostOnly
	}
	d, err := h.domains.FindVerified(r.Context(), host)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d.ID, nil
}

type linkBody struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	ShortURL  string  `json:"short_url"`
	DomainID  *int64  `json:"domain_id"`
	OriginURL string  `json:"origin_url"`
	ExpiresAt *string `json:"expires_at"`
	MaxClicks *int64  `json:"max_clicks"`
	Protected bool    `json:"protected"`
	CreatedAt string  `json:"created_at"`
} // @name Link

type CreateLinkRequest struct {
	URL       string     `json:"url"`
	ExpiresAt *time.Time `json:"expires_at"`
	Alias     string     `json:"alias"`
	DomainID  *int64     `json:"domain_id"`
	MaxClicks *int64     `json:"max_clicks"`
	Password  string     `json:"password"`
} // @name CreateLinkRequest

// Create shortens a URL for the organization the Tenant middleware already checked: a JWT
// caller belongs to it, an API key was issued for it.
//
//	@Summary		Create a short link
//	@Description	Needs a JWT or an API key with the write scope. alias, expires_at, max_clicks, password and domain_id are optional.
//	@Tags			links
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int					true	"Organization id"
//	@Param			body	body		CreateLinkRequest	true	"Link to create"
//	@Success		201		{object}	LinkResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	createLink
//	@Router			/orgs/{orgID}/links [post]
func (h *LinkHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in CreateLinkRequest
	if !decode(w, r, &in) {
		return
	}
	l, err := h.links.Shorten(r.Context(), link.ShortenInput{
		TenantID: tenant.ID, UserID: PrincipalFrom(r).UserID,
		URL: in.URL, DomainID: in.DomainID, Alias: in.Alias, ExpiresAt: in.ExpiresAt, MaxClicks: in.MaxClicks, Password: in.Password,
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, h.body(l))
}

func (h *LinkHandler) body(l link.Link) linkBody {
	return linkBody{
		ID: l.ID, Code: l.Code, ShortURL: shortURL(h.baseURL, l), DomainID: l.DomainID, OriginURL: l.OriginURL,
		ExpiresAt: formatTimePtr(l.ExpiresAt), MaxClicks: l.MaxClicks, Protected: l.Protected(), CreatedAt: formatTime(l.CreatedAt),
	}
}

// List answers one page of the organization's links, newest first.
//
//	@Summary		List links
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			links
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			limit	query		int	false	"Page size"
//	@Param			offset	query		int	false	"Items to skip"
//	@Success		200		{object}	LinkListResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	listLinks
//	@Router			/orgs/{orgID}/links [get]
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

// Get answers one link of the organization; one of another organization is a 404.
//
//	@Summary		Get a link
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			links
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			linkID	path		int	true	"Link id"
//	@Success		200		{object}	LinkResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	getLink
//	@Router			/orgs/{orgID}/links/{linkID} [get]
func (h *LinkHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := idParam(w, r, "linkID")
	if !ok {
		return
	}
	l, err := h.links.Get(r.Context(), tenant.ID, linkID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, h.body(l))
}

// Delete removes a link of the organization; one of another organization is a 404.
//
//	@Summary		Delete a link
//	@Description	Needs a JWT or an API key with the write scope.
//	@Tags			links
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path	int	true	"Organization id"
//	@Param			linkID	path	int	true	"Link id"
//	@Success		204
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@ID	deleteLink
//	@Router			/orgs/{orgID}/links/{linkID} [delete]
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
	domainID, err := h.domainID(r)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	ip := clientIP(r, h.trustProxy)
	l, err := h.links.Unlock(r.Context(), domainID, mux.Vars(r)["code"], password, ip.String())
	if err != nil {
		h.writeLocked(w, r, l, err)
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
	domainID, err := h.domainID(r)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	l, err := h.links.Resolve(r.Context(), domainID, mux.Vars(r)["code"])
	if err != nil {
		h.writeLocked(w, r, l, err)
		return
	}
	if h.clicks != nil {
		h.clicks.Record(analytics.Click{
			LinkID: l.ID, Referrer: r.Referer(), UserAgent: r.UserAgent(), IP: clientIP(r, h.trustProxy),
		})
	}
	http.Redirect(w, r, l.OriginURL, http.StatusFound)
}
