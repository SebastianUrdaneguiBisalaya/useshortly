package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
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

func (r *fakeLinkRepo) FindByCode(_ context.Context, code string) (link.Link, error) {
	l, ok := r.links[code]
	if !ok {
		return link.Link{}, link.ErrNotFound
	}
	return l, nil
}

type unusedGen struct{}

func (unusedGen) Generate() (string, error) { return "abc1234", nil }

func createLink(t *testing.T, h *LinkHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req = req.WithContext(WithTenant(req.Context(), Tenant{ID: 1}))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	return rec
}

func TestCreateLinkAlias(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{"taken": {Code: "taken"}}}
	h := NewLinkHandler(link.NewService(repo, unusedGen{}), "http://x")

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
