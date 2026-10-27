package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
)

func TestDefaultUnlockPageRenders(t *testing.T) {
	out, ok := renderUnlock(defaultUnlockHTML, unlockView{Action: "/abc-123/unlock", Code: "abc-123"})
	require.True(t, ok)
	page := string(out)
	assert.Contains(t, page, `action="/abc-123/unlock"`)
	assert.Contains(t, page, `type="password"`)
	assert.NotContains(t, page, `class="error"`, "no message, no error box")

	out, _ = renderUnlock(defaultUnlockHTML, unlockView{Action: "/x/unlock", Error: "Wrong."})
	assert.Contains(t, string(out), `class="error"`)
	assert.Contains(t, string(out), "Wrong.")
}

func TestRenderEscapesWhatItInserts(t *testing.T) {
	out, ok := renderUnlock(`<form action="{{.Action}}"><p>{{.Error}}</p></form>`,
		unlockView{Action: `/x"><script>alert(1)</script>/unlock`, Error: `<img src=x onerror=alert(1)>`})
	require.True(t, ok)
	assert.NotContains(t, string(out), "<script>")
	assert.NotContains(t, string(out), "<img")
}

func TestValidateUnlockTemplate(t *testing.T) {
	tests := []struct {
		name string
		html string
		ok   bool
	}{
		{"uses the action", `<form method="post" action="{{.Action}}"><input name="password"></form>`, true},
		{"uses every field", `<h1>{{.Code}}</h1>{{if .Error}}<p>{{.Error}}</p>{{end}}<form action="{{.Action}}"></form>`, true},
		{"never posts to the action", `<form action="/somewhere"></form>`, false},
		{"broken syntax", `<form action="{{.Action"></form>`, false},
		{"unknown field", `<form action="{{.Action}}">{{.Secret}}</form>`, false},
		{"calls a function that does not exist", `<form action="{{.Action}}">{{exec "ls"}}</form>`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg := validateUnlockTemplate(tt.html)
			if tt.ok {
				assert.Empty(t, msg)
			} else {
				assert.NotEmpty(t, msg)
			}
		})
	}
}

type fakePages struct {
	html string
	err  error
}

func (f fakePages) For(context.Context, int64, int64) (string, error) { return f.html, f.err }

func protectedFixture(t *testing.T, pages UnlockPages) (*LinkHandler, *fakeClicks) {
	t.Helper()
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	clicks := &fakeClicks{}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}, fakeHasher{}, allowAll{}), clicks, "http://x", false)
	if pages != nil {
		h.WithUnlockPages(pages)
	}
	rec := createLink(t, h, `{"url":"https://example.com/s","alias":"locked-1","password":"hunter22"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return h, clicks
}

// allowAll is a link.AttemptLimiter that never refuses.
type allowAll struct{}

func (allowAll) Take(context.Context, string, link.Backoff) (bool, time.Duration, error) {
	return true, 0, nil
}
func (allowAll) Reset(context.Context, string) error { return nil }

func visit(h *LinkHandler, accept string) *httptest.ResponseRecorder {
	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/locked-1", nil), map[string]string{"code": "locked-1"})
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	h.Redirect(rec, req)
	return rec
}

func TestProtectedLinkAnswersBrowsersWithAPageAndAPIClientsWithJSON(t *testing.T) {
	h, clicks := protectedFixture(t, nil)

	browser := visit(h, "text/html,application/xhtml+xml,*/*;q=0.8")
	assert.Equal(t, http.StatusUnauthorized, browser.Code)
	assert.Equal(t, "text/html; charset=utf-8", browser.Header().Get("Content-Type"))
	assert.Contains(t, browser.Body.String(), `action="/locked-1/unlock"`)
	assert.Contains(t, browser.Header().Get("Content-Security-Policy"), "default-src 'none'")
	assert.NotContains(t, browser.Header().Get("Content-Security-Policy"), "script-src", "scripts are blocked")
	assert.Equal(t, "no-store", browser.Header().Get("Cache-Control"))
	assert.Equal(t, "DENY", browser.Header().Get("X-Frame-Options"))

	for _, accept := range []string{"", "*/*", "application/json"} {
		api := visit(h, accept)
		assert.Equal(t, http.StatusUnauthorized, api.Code, accept)
		assert.Contains(t, api.Header().Get("Content-Type"), "application/json", accept)
		assert.Contains(t, api.Body.String(), "password_required", accept)
	}
	assert.Empty(t, clicks.got)
}

func TestProtectedLinkUsesTheCustomPage(t *testing.T) {
	h, _ := protectedFixture(t, fakePages{html: `<h1>Acme VIP</h1><form method="post" action="{{.Action}}"></form>`})
	rec := visit(h, "text/html")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Acme VIP")
	assert.Contains(t, rec.Body.String(), `action="/locked-1/unlock"`)
	assert.NotContains(t, rec.Body.String(), "This link is protected")
}

func TestProtectedLinkFallsBackToTheDefaultPage(t *testing.T) {
	for name, pages := range map[string]fakePages{
		"no custom page":          {err: unlockpage.ErrNotFound},
		"the lookup fails":        {err: assert.AnError},
		"the page does not parse": {html: `<form action="{{.Action"></form>`},
		"the page lost its field": {html: `<p>{{.Gone}}</p>`},
	} {
		h, _ := protectedFixture(t, pages)
		rec := visit(h, "text/html")
		assert.Equal(t, http.StatusUnauthorized, rec.Code, name)
		assert.Contains(t, rec.Body.String(), "This link is protected", name)
	}
}

func TestUnlockShowsMessagesOnThePage(t *testing.T) {
	h, clicks := protectedFixture(t, nil)
	post := func(password, accept string) *httptest.ResponseRecorder {
		req := mux.SetURLVars(httptest.NewRequest(http.MethodPost, "/locked-1/unlock", strings.NewReader("password="+password)),
			map[string]string{"code": "locked-1"})
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if accept != "" {
			req.Header.Set("Accept", accept)
		}
		rec := httptest.NewRecorder()
		h.Unlock(rec, req)
		return rec
	}

	wrong := post("nope", "text/html")
	assert.Equal(t, http.StatusUnauthorized, wrong.Code)
	assert.Contains(t, wrong.Body.String(), "not right")
	assert.Contains(t, wrong.Body.String(), `action="/locked-1/unlock"`)

	api := post("nope", "")
	assert.Equal(t, http.StatusUnauthorized, api.Code)
	assert.Contains(t, api.Body.String(), "wrong_password")

	right := post("hunter22", "text/html")
	assert.Equal(t, http.StatusFound, right.Code)
	assert.Equal(t, "https://example.com/s", right.Header().Get("Location"))
	require.Len(t, clicks.got, 1)
	assert.Empty(t, clicks.got[0].Referrer, "the unlock page is not where the visitor came from")
}
