package handler

import (
	"bytes"
	"context"
	_ "embed"
	"errors"
	"html/template"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
)

//go:embed unlock.html
var defaultUnlockHTML string

// unlockView is what an unlock page can show: the form target, a message for the visitor
// (empty at first) and the code of the link. Custom pages are html/template documents using
// {{.Action}} (required), {{.Error}} and {{.Code}}.
type unlockView struct {
	Action string
	Error  string
	Code   string
}

// UnlockPages tells which HTML to show for a protected link.
type UnlockPages interface {
	// For returns the custom page of the link or its organization, or unlockpage.ErrNotFound.
	For(ctx context.Context, tenantID, linkID int64) (string, error)
}

// OrgNames finds the display name of an organization.
type OrgNames interface {
	Name(ctx context.Context, tenantID int64) (string, error)
}

// WithUnlockFooter makes every unlock page end with who shared the link and, if abuseEmail is set,
// how to report it. The page text comes from the organization, so the footer is the one part a
// visitor can trust to be the application's.
func (h *LinkHandler) WithUnlockFooter(orgs OrgNames, abuseEmail string) *LinkHandler {
	h.orgs, h.abuseEmail = orgs, abuseEmail
	return h
}

// WithUnlockPages lets organizations replace the default unlock page. Without it every
// protected link shows the default one.
func (h *LinkHandler) WithUnlockPages(p UnlockPages) *LinkHandler {
	h.pages = p
	return h
}

// wantsHTML is true for browsers; API clients (curl, fetch with JSON) keep getting the JSON error.
func wantsHTML(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// writeLocked answers a refused visit to a protected link. A browser gets the unlock page and an
// API client the JSON error. Any other error is a plain error response.
func (h *LinkHandler) writeLocked(w http.ResponseWriter, r *http.Request, l link.Link, err error) {
	var status int
	var message string
	switch {
	case errors.Is(err, link.ErrPasswordRequired):
		status = http.StatusUnauthorized
	case errors.Is(err, link.ErrWrongPassword):
		status, message = http.StatusUnauthorized, "That password is not right. Try again."
	case errors.Is(err, link.ErrTooManyAttempts):
		wait, _ := link.RetryAfter(err)
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		status, message = http.StatusTooManyRequests, "Too many attempts. Try again in "+humanWait(wait)+"."
	default:
		WriteError(w, r, err)
		return
	}
	if !wantsHTML(r) {
		WriteError(w, r, err)
		return
	}
	view := unlockView{Action: "/" + l.Code + "/unlock", Error: message, Code: l.Code}
	body, ok := renderUnlock(h.pageFor(r.Context(), l), view)
	if !ok {
		slog.Warn("unlock page does not render, using the default", "link_id", l.ID, "tenant_id", l.TenantID)
		body, _ = renderUnlock(defaultUnlockHTML, view)
	}
	writeHTML(w, status, h.withFooter(r.Context(), body, l))
}

// humanWait says a wait in the largest whole unit that does not cut it short: 30 seconds,
// 2 minutes, 1 hour.
func humanWait(d time.Duration) string {
	unit := func(n int, name string) string {
		if n == 1 {
			return "1 " + name
		}
		return strconv.Itoa(n) + " " + name + "s"
	}
	switch {
	case d < time.Minute:
		return unit(max(int(math.Ceil(d.Seconds())), 1), "second")
	case d < time.Hour:
		return unit(int(math.Ceil(d.Minutes())), "minute")
	default:
		return unit(int(math.Ceil(d.Hours())), "hour")
	}
}

// pageFor is the custom page of the link, or the default one.
func (h *LinkHandler) pageFor(ctx context.Context, l link.Link) string {
	if h.pages == nil {
		return defaultUnlockHTML
	}
	html, err := h.pages.For(ctx, l.TenantID, l.ID)
	if err != nil {
		if !errors.Is(err, unlockpage.ErrNotFound) {
			slog.Warn("unlock page lookup failed, using the default", "link_id", l.ID, "error", err)
		}
		return defaultUnlockHTML
	}
	return html
}

// renderUnlock fills an unlock page. ok is false if the page is not a valid template.
func renderUnlock(source string, view unlockView) ([]byte, bool) {
	t, err := template.New("unlock").Parse(source)
	if err != nil {
		return nil, false
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, view); err != nil {
		return nil, false
	}
	return buf.Bytes(), true
}

// writeHTML sends a page that must never run scripts or be cached: it may come from an
// organization, and it can show the state of a password check.
func writeHTML(w http.ResponseWriter, status int, body []byte) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	// sandbox (no allow-scripts) gives the page an opaque origin: whatever it contains, it cannot
	// reach the app's origin; forms are still allowed so the password can be sent.
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'none'; frame-ancestors 'none'; sandbox allow-forms")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// UnlockPageHandler lets an organization set the page of its protected links.
type UnlockPageHandler struct {
	pages *unlockpage.Service
}

func NewUnlockPageHandler(pages *unlockpage.Service) *UnlockPageHandler {
	return &UnlockPageHandler{pages: pages}
}

type unlockPageBody struct {
	LinkID    *int64 `json:"link_id"`
	HTML      string `json:"html"`
	UpdatedBy int64  `json:"updated_by"`
	UpdatedAt string `json:"updated_at"`
} // @name UnlockPage

type unlockPageEventBody struct {
	LinkID *int64 `json:"link_id"`
	UserID int64  `json:"user_id"`
	Action string `json:"action"`
	At     string `json:"at"`
} // @name UnlockPageEvent

type SetUnlockPageRequest struct {
	HTML string `json:"html"`
} // @name SetUnlockPageRequest

// scope reads the optional {linkID} of the route: none is the organization's page.
func scope(w http.ResponseWriter, r *http.Request) (*int64, bool) {
	if _, ok := mux.Vars(r)["linkID"]; !ok {
		return nil, true
	}
	id, ok := idParam(w, r, "linkID")
	if !ok {
		return nil, false
	}
	return &id, true
}

// Put sets the page. The HTML must be a template that uses {{.Action}} for the form target, or the
// visitor could never submit the password.
//
//	@Summary		Set the organization's unlock page
//	@Description	The page all the organization's protected links show, unless a link has its own. The HTML must post its form to {{.Action}}. Needs a JWT or an API key with the write scope.
//	@Tags			unlock-page
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int						true	"Organization id"
//	@Param			body	body		SetUnlockPageRequest	true	"Page HTML"
//	@Success		200		{object}	UnlockPageResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID				setOrganizationUnlockPage
//	@Router			/orgs/{orgID}/unlock-page [put]
func (h *UnlockPageHandler) Put(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := scope(w, r)
	if !ok {
		return
	}
	var in SetUnlockPageRequest
	if !decode(w, r, &in) {
		return
	}
	if msg := validateUnlockTemplate(in.HTML); msg != "" {
		WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_template", "the page is not a valid unlock page",
			[]FieldError{{Field: "html", Message: msg}})
		return
	}
	p, err := h.pages.Set(r.Context(), tenant.ID, PrincipalFrom(r).UserID, linkID, in.HTML)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, newUnlockPageBody(p))
}

// Get returns the page of the organization or of one of its links.
//
//	@Summary		Get the organization's unlock page
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			unlock-page
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Success		200		{object}	UnlockPageResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID				getOrganizationUnlockPage
//	@Router			/orgs/{orgID}/unlock-page [get]
func (h *UnlockPageHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := scope(w, r)
	if !ok {
		return
	}
	p, err := h.pages.Get(r.Context(), tenant.ID, linkID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, newUnlockPageBody(p))
}

// Delete removes the page, going back to the default one.
//
//	@Summary		Delete the organization's unlock page
//	@Description	Goes back to the default page. Needs a JWT or an API key with the write scope.
//	@Tags			unlock-page
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path	int	true	"Organization id"
//	@Success		204
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@ID				deleteOrganizationUnlockPage
//	@Router			/orgs/{orgID}/unlock-page [delete]
func (h *UnlockPageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := scope(w, r)
	if !ok {
		return
	}
	if err := h.pages.Delete(r.Context(), tenant.ID, PrincipalFrom(r).UserID, linkID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetForLink is Get for the page of one link, so the spec can describe both routes.
//
//	@Summary		Get a link's unlock page
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			unlock-page
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			linkID	path		int	true	"Link id"
//	@Success		200		{object}	UnlockPageResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID				getLinkUnlockPage
//	@Router			/orgs/{orgID}/links/{linkID}/unlock-page [get]
func (h *UnlockPageHandler) GetForLink(w http.ResponseWriter, r *http.Request) { h.Get(w, r) }

// PutForLink is Put for the page of one link, so the spec can describe both routes.
//
//	@Summary		Set a link's unlock page
//	@Description	The page that link shows instead of the organization's. The HTML must post its form to {{.Action}}. Needs a JWT or an API key with the write scope.
//	@Tags			unlock-page
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int						true	"Organization id"
//	@Param			linkID	path		int						true	"Link id"
//	@Param			body	body		SetUnlockPageRequest	true	"Page HTML"
//	@Success		200		{object}	UnlockPageResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID				setLinkUnlockPage
//	@Router			/orgs/{orgID}/links/{linkID}/unlock-page [put]
func (h *UnlockPageHandler) PutForLink(w http.ResponseWriter, r *http.Request) { h.Put(w, r) }

// DeleteForLink is Delete for the page of one link, so the spec can describe both routes.
//
//	@Summary		Delete a link's unlock page
//	@Description	The link goes back to the organization's page. Needs a JWT or an API key with the write scope.
//	@Tags			unlock-page
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path	int	true	"Organization id"
//	@Param			linkID	path	int	true	"Link id"
//	@Success		204
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@ID				deleteLinkUnlockPage
//	@Router			/orgs/{orgID}/links/{linkID}/unlock-page [delete]
func (h *UnlockPageHandler) DeleteForLink(w http.ResponseWriter, r *http.Request) { h.Delete(w, r) }

// History answers who changed the organization's unlock pages, newest first, paginated.
//
//	@Summary		Unlock page history
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			unlock-page
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			limit	query		int	false	"Page size"
//	@Param			offset	query		int	false	"Items to skip"
//	@Success		200		{object}	UnlockPageHistoryResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID				getUnlockPageHistory
//	@Router			/orgs/{orgID}/unlock-page/history [get]
func (h *UnlockPageHandler) History(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	events, total, err := h.pages.History(r.Context(), tenant.ID, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]unlockPageEventBody, 0, len(events))
	for _, e := range events {
		out = append(out, unlockPageEventBody{LinkID: e.LinkID, UserID: e.UserID, Action: string(e.Action), At: formatTime(e.At)})
	}
	writePage(w, out, p, total)
}

func newUnlockPageBody(p unlockpage.Page) unlockPageBody {
	return unlockPageBody{LinkID: p.LinkID, HTML: p.HTML, UpdatedBy: p.UpdatedBy, UpdatedAt: formatTime(p.UpdatedAt)}
}

// validateUnlockTemplate returns why html cannot be an unlock page, or "" if it can.
func validateUnlockTemplate(html string) string {
	const sample = "/sample-code/unlock"
	out, ok := renderUnlock(html, unlockView{Action: sample, Error: "sample error", Code: "sample-code"})
	if !ok {
		return "not a valid template: check the {{...}} placeholders; the ones available are .Action, .Error and .Code"
	}
	if !bytes.Contains(out, []byte(sample)) {
		return "the form must post to {{.Action}}"
	}
	return ""
}

// footerStyle is written inline with !important, which beats any rule in the organization's own
// stylesheet, so a page cannot simply hide the footer with a selector. A page that restyles the
// document itself (hiding the body, say) can still defeat it: it is a deterrent to impersonation,
// backed by the edit history and the abuse contact, not a guarantee.
const footerStyle = "display:block!important;visibility:visible!important;opacity:1!important;position:static!important;" +
	"float:none!important;clear:both!important;transform:none!important;height:auto!important;overflow:visible!important;" +
	"max-width:560px!important;margin:24px auto 0!important;padding:12px 16px!important;box-sizing:border-box!important;" +
	"background:#fff!important;color:#444!important;border:1px solid #ccc!important;border-radius:8px!important;" +
	"font:13px/1.5 system-ui,sans-serif!important;text-align:center!important;"

var footerTemplate = template.Must(template.New("footer").Parse(
	`<div data-app-footer style="{{.Style}}">This link was shared by <strong>{{.Org}}</strong>.` +
		`{{if .ReportURL}} <a href="{{.ReportURL}}" rel="noopener noreferrer" style="color:#0b5cd5!important;text-decoration:underline!important">Report abuse</a>{{end}}</div>`))

// withFooter adds the footer just before </body>, or at the end if the page has none.
func (h *LinkHandler) withFooter(ctx context.Context, page []byte, l link.Link) []byte {
	org := "the owner of this link"
	if h.orgs != nil {
		if name, err := h.orgs.Name(ctx, l.TenantID); err == nil && strings.TrimSpace(name) != "" {
			org = name
		}
	}
	data := struct {
		Style     template.CSS
		Org       string
		ReportURL template.URL
	}{Style: template.CSS(footerStyle), Org: org}
	if h.abuseEmail != "" {
		data.ReportURL = template.URL("mailto:" + h.abuseEmail + "?subject=" + url.PathEscape("Report link /"+l.Code))
	}
	var footer bytes.Buffer
	if err := footerTemplate.Execute(&footer, data); err != nil {
		return page
	}
	if i := bytes.LastIndex(bytes.ToLower(page), []byte("</body>")); i >= 0 {
		return append(append(append([]byte{}, page[:i]...), footer.Bytes()...), page[i:]...)
	}
	return append(append([]byte{}, page...), footer.Bytes()...)
}
