package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

// A route that forgets the Tenant middleware must fail closed, not act on an unchecked org.
func TestTenantHandlersFailClosedWithoutTheMiddleware(t *testing.T) {
	for name, h := range map[string]http.HandlerFunc{
		"create link":    NewLinkHandler(nil, nil, "http://x", false).Create,
		"create api key": NewAPIKeyHandler(nil).Create,
		"list api keys":  NewAPIKeyHandler(nil).List,
		"delete api key": NewAPIKeyHandler(nil).Delete,
		"get org":        NewOrgHandler(nil).Get,
		"invite":         NewOrgHandler(nil).Invite,
	} {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", nil))
		assert.Equal(t, http.StatusInternalServerError, rec.Code, name)
		assert.Contains(t, rec.Body.String(), "internal_error", name)
	}
}
