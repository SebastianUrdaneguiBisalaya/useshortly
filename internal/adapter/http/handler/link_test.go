package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type fakeLinkRepo struct {
	links map[string]link.Link
}

func (r *fakeLinkRepo) Create(_ context.Context, l link.Link) (link.Link, error) {
	if _, ok := r.links[l.Code]; ok {
		return link.Link{}, link.ErrCodeTaken
	}
	l.ID = int64(len(r.links) + 1)
	r.links[l.Code] = l
	return l, nil
}

func (r *fakeLinkRepo) FindByID(_ context.Context, tenantID, id int64) (link.Link, error) {
	for _, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			return l, nil
		}
	}
	return link.Link{}, link.ErrNotFound
}

func (r *fakeLinkRepo) ListByTenant(_ context.Context, tenantID int64, p page.Params) ([]link.Link, int, error) {
	var all []link.Link
	for _, l := range r.links {
		if l.TenantID == tenantID {
			all = append(all, l)
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID > all[j].ID })
	lo := min(p.Offset, len(all))
	hi := min(lo+p.Limit, len(all))
	return all[lo:hi], len(all), nil
}

func (r *fakeLinkRepo) Delete(_ context.Context, tenantID, id int64) error {
	for code, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			delete(r.links, code)
			return nil
		}
	}
	return link.ErrNotFound
}

func (r *fakeLinkRepo) ConsumeClick(_ context.Context, id int64) error {
	for code, l := range r.links {
		if l.ID != id {
			continue
		}
		if l.MaxClicks != nil && l.ClickCount >= *l.MaxClicks {
			return link.ErrExpired
		}
		l.ClickCount++
		r.links[code] = l
		return nil
	}
	return link.ErrNotFound
}

func (r *fakeLinkRepo) FindByCode(_ context.Context, domainID *int64, code string) (link.Link, error) {
	l, ok := r.links[code]
	if !ok || (l.DomainID == nil) != (domainID == nil) || (domainID != nil && *l.DomainID != *domainID) {
		return link.Link{}, link.ErrNotFound
	}
	return l, nil
}

// fakeHasher "hashes" by prefixing.
type fakeHasher struct{}

func (fakeHasher) Hash(password string) (string, error)       { return "hash:" + password, nil }
func (fakeHasher) Verify(hash, password string) (bool, error) { return hash == "hash:"+password, nil }

type unusedGen struct{}

func (unusedGen) Generate() (string, error) { return "abc1234", nil }

func createLink(t *testing.T, h *LinkHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(WithTenant(req.Context(), Tenant{ID: 1}))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	return rec
}

func TestCreateLinkAlias(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{"taken": {Code: "taken"}}}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}, fakeHasher{}, nil), nil, "http://x", false)

	t.Run("uses the alias as the code", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","alias":"promo"}`)
		require.Equal(t, http.StatusCreated, rec.Code)
		assert.Contains(t, rec.Body.String(), `"short_url":"http://x/promo"`)
	})

	t.Run("taken alias is a 409", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","alias":"taken"}`)
		assert.Equal(t, http.StatusConflict, rec.Code)
		assert.Contains(t, rec.Body.String(), "alias_taken")
	})

	t.Run("invalid alias is a 400", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","alias":"a/b"}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "invalid_alias")
	})
}

func TestCreateLinkExpiration(t *testing.T) {
	h := NewLinkHandler(link.NewService(&fakeLinkRepo{links: map[string]link.Link{}}, unusedGen{}, fakeHasher{}, nil), nil, "http://x", false)
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)

	t.Run("accepts expires_at and max_clicks", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","expires_at":"`+future+`","max_clicks":5}`)
		require.Equal(t, http.StatusCreated, rec.Code)
		assert.Contains(t, rec.Body.String(), `"max_clicks":5`)
		assert.Contains(t, rec.Body.String(), `"expires_at":"`+future)
	})

	t.Run("expires_at in the past is a 400", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","expires_at":"2020-01-01T00:00:00Z"}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "invalid_expiry")
	})

	t.Run("expires_at that is not RFC3339 is a 400", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com","expires_at":"tomorrow"}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "invalid_body")
	})

	t.Run("max_clicks below 1 is a 400", func(t *testing.T) {
		for _, n := range []string{"0", "-3"} {
			rec := createLink(t, h, `{"url":"https://example.com","max_clicks":`+n+`}`)
			assert.Equal(t, http.StatusBadRequest, rec.Code, n)
			assert.Contains(t, rec.Body.String(), "invalid_max_clicks", n)
		}
	})
}

func TestRedirectStopsAfterMaxClicks(t *testing.T) {
	h := NewLinkHandler(link.NewService(&fakeLinkRepo{links: map[string]link.Link{}}, unusedGen{}, fakeHasher{}, nil), nil, "http://x", false)
	require.Equal(t, http.StatusCreated, createLink(t, h, `{"url":"https://example.com/t","alias":"once","max_clicks":1}`).Code)

	redirect := func() *httptest.ResponseRecorder {
		req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/once", nil), map[string]string{"code": "once"})
		rec := httptest.NewRecorder()
		h.Redirect(rec, req)
		return rec
	}
	first := redirect()
	assert.Equal(t, http.StatusFound, first.Code)
	assert.Equal(t, "https://example.com/t", first.Header().Get("Location"))

	second := redirect()
	assert.Equal(t, http.StatusGone, second.Code)
	assert.Contains(t, second.Body.String(), "link_expired")
}

func TestPageParams(t *testing.T) {
	tests := []struct {
		query   string
		want    page.Params
		wantErr bool
	}{
		{"", page.Params{Limit: page.DefaultLimit}, false},
		{"limit=10&offset=20", page.Params{Limit: 10, Offset: 20}, false},
		{"limit=1000", page.Params{Limit: page.MaxLimit}, false},
		{"limit=0", page.Params{}, true},
		{"limit=-1", page.Params{}, true},
		{"limit=abc", page.Params{}, true},
		{"offset=-1", page.Params{}, true},
		{"offset=1.5", page.Params{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			rec := httptest.NewRecorder()
			got, ok := pageParams(rec, httptest.NewRequest(http.MethodGet, "/?"+tt.query, nil))
			assert.Equal(t, !tt.wantErr, ok)
			if tt.wantErr {
				assert.Equal(t, http.StatusBadRequest, rec.Code)
				assert.Contains(t, rec.Body.String(), "invalid_pagination")
				return
			}
			assert.Equal(t, tt.want, got)
		})
	}
}

type fakeClicks struct{ got []analytics.Click }

func (f *fakeClicks) Record(c analytics.Click) { f.got = append(f.got, c) }

func TestRedirectRecordsTheClick(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	clicks := &fakeClicks{}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}, fakeHasher{}, nil), clicks, "http://x", false)
	created := createLink(t, h, `{"url":"https://example.com/t","alias":"promo","max_clicks":1}`)
	require.Equal(t, http.StatusCreated, created.Code)
	linkID := repo.links["promo"].ID

	visit := func() *httptest.ResponseRecorder {
		req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/promo", nil), map[string]string{"code": "promo"})
		req.Header.Set("Referer", "https://news.example/a")
		req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone)")
		rec := httptest.NewRecorder()
		h.Redirect(rec, req)
		return rec
	}

	assert.Equal(t, http.StatusFound, visit().Code)
	require.Len(t, clicks.got, 1)
	assert.Equal(t, analytics.Click{
		LinkID: linkID, Referrer: "https://news.example/a", UserAgent: "Mozilla/5.0 (iPhone)",
		IP: netip.MustParseAddr("192.0.2.1"), // httptest's default remote address
	}, clicks.got[0])

	assert.Equal(t, http.StatusGone, visit().Code, "the link used its only click")
	assert.Len(t, clicks.got, 1, "a refused redirect is not a click")

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/nope", nil), map[string]string{"code": "nope"})
	rec := httptest.NewRecorder()
	h.Redirect(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Len(t, clicks.got, 1, "an unknown code is not a click")
}

func TestCreateProtectedLink(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	clicks := &fakeClicks{}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}, fakeHasher{}, nil), clicks, "http://x", false)

	rec := createLink(t, h, `{"url":"https://example.com/s","alias":"locked-1","password":"hunter22"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"protected":true`)
	assert.NotContains(t, rec.Body.String(), "hunter22", "the password never comes back")
	assert.NotContains(t, rec.Body.String(), "hash:", "nor its hash")
	assert.Equal(t, "hash:hunter22", repo.links["locked-1"].PasswordHash)

	open := createLink(t, h, `{"url":"https://example.com/s","alias":"open-001"}`)
	assert.Contains(t, open.Body.String(), `"protected":false`)

	bad := createLink(t, h, `{"url":"https://example.com/s","password":"abc"}`)
	assert.Equal(t, http.StatusBadRequest, bad.Code)
	assert.Contains(t, bad.Body.String(), "invalid_password")

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/locked-1", nil), map[string]string{"code": "locked-1"})
	visit := httptest.NewRecorder()
	h.Redirect(visit, req)
	assert.Equal(t, http.StatusUnauthorized, visit.Code)
	assert.Contains(t, visit.Body.String(), "password_required")
	assert.Empty(t, visit.Header().Get("Location"), "a protected link does not redirect")
	assert.Empty(t, clicks.got, "a refused visit is not a click")
}

func TestGetLink(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}, fakeHasher{}, nil), &fakeClicks{}, "http://x", false)
	created := createLink(t, h, `{"url":"https://example.com/g","alias":"get-link"}`)
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())

	get := func(tenantID int64, linkID string) *httptest.ResponseRecorder {
		req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/", nil), map[string]string{"linkID": linkID})
		req = req.WithContext(WithTenant(req.Context(), Tenant{ID: tenantID}))
		rec := httptest.NewRecorder()
		h.Get(rec, req)
		return rec
	}

	found := get(1, "1")
	require.Equal(t, http.StatusOK, found.Code, found.Body.String())
	assert.Contains(t, found.Body.String(), `"code":"get-link"`)
	assert.Contains(t, found.Body.String(), `"short_url":"http://x/get-link"`)

	assert.Equal(t, http.StatusNotFound, get(2, "1").Code, "another organization's link is a 404")
	assert.Equal(t, http.StatusNotFound, get(1, "99").Code)
	assert.Equal(t, http.StatusNotFound, get(1, "abc").Code, "an id that is not a number matches no link")
}
