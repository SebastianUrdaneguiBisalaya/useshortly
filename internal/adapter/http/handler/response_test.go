package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEnvelope(t *testing.T) {
	t.Run("success wraps the payload in data", func(t *testing.T) {
		rec := httptest.NewRecorder()
		writeData(rec, http.StatusCreated, map[string]string{"code": "abc"})
		assert.Equal(t, http.StatusCreated, rec.Code)
		assert.JSONEq(t, `{"data":{"code":"abc"}}`, rec.Body.String())
	})

	t.Run("error has no data and no details by default", func(t *testing.T) {
		rec := httptest.NewRecorder()
		WriteAPIError(rec, http.StatusConflict, "alias_taken", "taken")
		assert.JSONEq(t, `{"error":{"code":"alias_taken","message":"taken"}}`, rec.Body.String())
	})

	t.Run("error carries field details", func(t *testing.T) {
		rec := httptest.NewRecorder()
		WriteAPIErrorDetails(rec, http.StatusBadRequest, "invalid_body", "bad", []FieldError{{Field: "alias", Message: "too short"}})
		assert.JSONEq(t, `{"error":{"code":"invalid_body","message":"bad","details":[{"field":"alias","message":"too short"}]}}`, rec.Body.String())
	})
}

func TestDecodeContentType(t *testing.T) {
	cases := []struct {
		name, contentType string
		status            int
		code              string
	}{
		{"json", "application/json", http.StatusOK, ""},
		{"json with charset", "application/json; charset=utf-8", http.StatusOK, ""},
		{"missing", "", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"form", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"text", "text/plain", http.StatusUnsupportedMediaType, "unsupported_media_type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
			if c.contentType != "" {
				req.Header.Set("Content-Type", c.contentType)
			}
			rec := httptest.NewRecorder()
			var dst struct{}
			ok := decode(rec, req, &dst)
			if c.code == "" {
				assert.True(t, ok)
				return
			}
			assert.False(t, ok)
			assert.Equal(t, c.status, rec.Code)
			assert.Contains(t, rec.Body.String(), c.code)
		})
	}
}

type unencodable struct{}

func (unencodable) MarshalJSON() ([]byte, error) { return nil, assert.AnError }

func TestWriteJSONEncodeFailureIs500(t *testing.T) {
	rec := httptest.NewRecorder()
	writeData(rec, http.StatusCreated, unencodable{})
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "internal_error")
}
