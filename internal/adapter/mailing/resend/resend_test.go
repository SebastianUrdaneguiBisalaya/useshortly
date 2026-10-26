package resend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestSender(t *testing.T, handler http.HandlerFunc) *Sender {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	s := New("re_test_key", "useshortly <no-reply@example.com>")
	u, err := url.Parse(srv.URL + "/")
	require.NoError(t, err)
	s.client.BaseURL = u
	return s
}

func TestSend(t *testing.T) {
	var gotAuth, gotPath string
	var body map[string]any
	s := newTestSender(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	})

	err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", HTML: "<p>Hi</p>", Text: "Hi"})
	require.NoError(t, err)
	assert.Equal(t, "Bearer re_test_key", gotAuth)
	assert.Equal(t, "/emails", gotPath)
	assert.Equal(t, "useshortly <no-reply@example.com>", body["from"])
	assert.Equal(t, []any{"ana@x.com"}, body["to"])
	assert.Equal(t, "Hi", body["subject"])
	assert.Equal(t, "<p>Hi</p>", body["html"])
	assert.Equal(t, "Hi", body["text"])
}

func TestSendReportsProviderErrors(t *testing.T) {
	s := newTestSender(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"invalid from"}`))
	})
	err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	assert.ErrorContains(t, err, "resend: send")
}

func TestSendHonoursContext(t *testing.T) {
	s := newTestSender(t, func(http.ResponseWriter, *http.Request) {})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.Error(t, s.Send(ctx, mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"}))
}
