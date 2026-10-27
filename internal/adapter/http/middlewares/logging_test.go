package middlewares

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	return &buf
}

func TestRecoverAnswers500AndLogs(t *testing.T) {
	logs := captureLogs(t)
	h := RequestLog(Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })))

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/x?token=secret", nil))

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.Contains(t, rr.Body.String(), "internal_error")
	out := logs.String()
	assert.Contains(t, out, "panic in handler")
	assert.Contains(t, out, "boom")
	assert.Contains(t, out, "status=500")
	assert.False(t, strings.Contains(out, "secret"))
}

func TestRecoverKeepsStartedResponse(t *testing.T) {
	captureLogs(t)
	h := Recover(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		panic("late")
	}))

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusAccepted, rr.Code)
}

func TestRequestLogFields(t *testing.T) {
	logs := captureLogs(t)
	h := RequestLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusFound) }))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/abc", nil))

	out := logs.String()
	for _, want := range []string{"method=GET", "path=/abc", "status=302", "duration="} {
		assert.Contains(t, out, want)
	}
}

func TestRecoverRepanicsOnAbort(t *testing.T) {
	h := Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) }))
	assert.PanicsWithValue(t, http.ErrAbortHandler, func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	})
}
