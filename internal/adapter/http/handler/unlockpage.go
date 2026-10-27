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
	writeHTML(w, status, body)
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
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'none'; frame-ancestors 'none'")
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
	UpdatedAt string `json:"updated_at"`
}

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
func (h *UnlockPageHandler) Put(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := scope(w, r)
	if !ok {
		return
	}
	var in struct {
		HTML string `json:"html"`
	}
	if !decode(w, r, &in) {
		return
	}
	if msg := validateUnlockTemplate(in.HTML); msg != "" {
		WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_template", "the page is not a valid unlock page",
			[]FieldError{{Field: "html", Message: msg}})
		return
	}
	p, err := h.pages.Set(r.Context(), tenant.ID, linkID, in.HTML)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, newUnlockPageBody(p))
}

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

func (h *UnlockPageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := scope(w, r)
	if !ok {
		return
	}
	if err := h.pages.Delete(r.Context(), tenant.ID, linkID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func newUnlockPageBody(p unlockpage.Page) unlockPageBody {
	return unlockPageBody{LinkID: p.LinkID, HTML: p.HTML, UpdatedAt: formatTime(p.UpdatedAt)}
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
