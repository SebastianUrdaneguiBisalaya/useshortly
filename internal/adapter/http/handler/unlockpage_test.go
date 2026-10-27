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

type fakeOrgs struct {
	name string
	err  error
}

func (f fakeOrgs) Name(context.Context, int64) (string, error) { return f.name, f.err }

func TestUnlockPagesAreSandboxed(t *testing.T) {
	h, _ := protectedFixture(t, nil)
	csp := visit(h, "text/html").Header().Get("Content-Security-Policy")
	assert.Contains(t, csp, "sandbox allow-forms", "an opaque origin that can still send the form")
	assert.NotContains(t, csp, "allow-scripts")
	assert.NotContains(t, csp, "allow-same-origin")
	assert.Contains(t, csp, "default-src 'none'")
}

func TestUnlockPageFooter(t *testing.T) {
	t.Run("names the organization and offers a report link", func(t *testing.T) {
		h, _ := protectedFixture(t, nil)
		h.WithUnlockFooter(fakeOrgs{name: "Acme"}, "abuse@useshortly.test")
		body := visit(h, "text/html").Body.String()
		assert.Contains(t, body, "data-app-footer")
		assert.Contains(t, body, "<strong>Acme</strong>")
		assert.Contains(t, body, `href="mailto:abuse@useshortly.test?subject=Report%20link%20%2Flocked-1"`)
		assert.Less(t, strings.Index(body, `action="/locked-1/unlock"`), strings.Index(body, "data-app-footer"), "after the form")
		assert.Less(t, strings.Index(body, "data-app-footer"), strings.Index(body, "</body>"), "inside the body")
	})

	t.Run("no abuse address, no report link", func(t *testing.T) {
		h, _ := protectedFixture(t, nil)
		h.WithUnlockFooter(fakeOrgs{name: "Acme"}, "")
		body := visit(h, "text/html").Body.String()
		assert.Contains(t, body, "data-app-footer")
		assert.NotContains(t, body, "Report abuse")
	})

	t.Run("escapes the organization's name", func(t *testing.T) {
		h, _ := protectedFixture(t, nil)
		h.WithUnlockFooter(fakeOrgs{name: `<script>alert(1)</script>`}, "")
		body := visit(h, "text/html").Body.String()
		assert.NotContains(t, body, "<script>alert(1)")
		assert.Contains(t, body, "&lt;script&gt;")
	})

	t.Run("an unknown organization still gets a footer", func(t *testing.T) {
		h, _ := protectedFixture(t, nil)
		h.WithUnlockFooter(fakeOrgs{err: assert.AnError}, "")
		assert.Contains(t, visit(h, "text/html").Body.String(), "the owner of this link")
	})

	t.Run("a custom page cannot hide it with a stylesheet", func(t *testing.T) {
		h, _ := protectedFixture(t, fakePages{html: `<html><head><style>[data-app-footer], div { display: none !important; }</style></head>` +
			`<body><form method="post" action="{{.Action}}"></form></body></html>`})
		h.WithUnlockFooter(fakeOrgs{name: "Acme"}, "")
		body := visit(h, "text/html").Body.String()
		footer := body[strings.Index(body, "<div data-app-footer"):]
		footer = footer[:strings.Index(footer, "</div>")]
		assert.Contains(t, footer, "display:block!important", "inline !important wins over the page's own rules")
		assert.Contains(t, footer, "visibility:visible!important")
	})

	t.Run("a page without a body tag still gets it at the end", func(t *testing.T) {
		h, _ := protectedFixture(t, fakePages{html: `<form method="post" action="{{.Action}}"></form>`})
		h.WithUnlockFooter(fakeOrgs{name: "Acme"}, "")
		body := visit(h, "text/html").Body.String()
		assert.True(t, strings.HasSuffix(body, "</div>"), body)
	})

	t.Run("the JSON answer has no footer", func(t *testing.T) {
		h, _ := protectedFixture(t, nil)
		h.WithUnlockFooter(fakeOrgs{name: "Acme"}, "")
		assert.NotContains(t, visit(h, "application/json").Body.String(), "data-app-footer")
	})
}

func TestHumanWait(t *testing.T) {
	tests := map[time.Duration]string{
		time.Millisecond:                      "1 second",
		30 * time.Second:                      "30 seconds",
		59*time.Second + 400*time.Millisecond: "60 seconds",
		time.Minute:                           "1 minute",
		90 * time.Second:                      "2 minutes",
		2 * time.Minute:                       "2 minutes",
		time.Hour:                             "1 hour",
		time.Hour + time.Second:               "2 hours",
	}
	for d, want := range tests {
		assert.Equal(t, want, humanWait(d), d.String())
	}
}
