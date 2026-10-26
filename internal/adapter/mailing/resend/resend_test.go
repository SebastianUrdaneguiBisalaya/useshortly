package resend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	resendlib "github.com/resend/resend-go/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var _ mailing.Sender = (*Sender)(nil)

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

func TestSendReturnsTheProviderID(t *testing.T) {
	var gotAuth, gotPath string
	var body map[string]any
	s := newTestSender(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}`))
	})

	receipt, err := s.Send(context.Background(), mailing.Message{
		To: "ana@x.com", CC: []string{"boss@x.com"}, BCC: []string{"audit@x.com", "ceo@x.com"},
		Subject: "Hi", HTML: "<p>Hi</p>", Text: "Hi",
	})
	require.NoError(t, err)
	assert.Equal(t, mailing.Receipt{Provider: "RESEND", ProviderID: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}, receipt)
	assert.Equal(t, "Bearer re_test_key", gotAuth)
	assert.Equal(t, "/emails", gotPath)
	assert.Equal(t, "useshortly <no-reply@example.com>", body["from"])
	assert.Equal(t, []any{"ana@x.com"}, body["to"])
	assert.Equal(t, []any{"boss@x.com"}, body["cc"])
	assert.Equal(t, []any{"audit@x.com", "ceo@x.com"}, body["bcc"])
	assert.Equal(t, "Hi", body["subject"])
	assert.Equal(t, "<p>Hi</p>", body["html"])
	assert.Equal(t, "Hi", body["text"])
}

func TestSendOmitsEmptyCopies(t *testing.T) {
	var body map[string]any
	s := newTestSender(t, func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"x"}`))
	})
	_, err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	require.NoError(t, err)
	assert.NotContains(t, body, "cc")
	assert.NotContains(t, body, "bcc")
}

func TestSendFailureKeepsTheProviderAndTheMessage(t *testing.T) {
	s := newTestSender(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"The from address is invalid"}`))
	})
	receipt, err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	require.Error(t, err)
	assert.Equal(t, mailing.Receipt{Provider: "RESEND"}, receipt, "no id, but the provider is known")
	assert.ErrorContains(t, err, "resend: send")
	assert.ErrorContains(t, err, "The from address is invalid")
}

func TestSendRateLimitIsDetectable(t *testing.T) {
	s := newTestSender(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("retry-after", "7")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"message":"Too many requests"}`))
	})
	receipt, err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	assert.ErrorIs(t, err, resendlib.ErrRateLimit)
	assert.ErrorContains(t, err, "retry after: 7")
	assert.Equal(t, "RESEND", receipt.Provider)
	assert.Empty(t, receipt.ProviderID)
}

func TestSendServerErrorAndNetworkFailure(t *testing.T) {
	s := newTestSender(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"Internal error"}`))
	})
	_, err := s.Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	assert.ErrorContains(t, err, "Internal error")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	receipt, err := s.Send(ctx, mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"})
	assert.Error(t, err)
	assert.True(t, errors.Is(err, context.Canceled))
	assert.Equal(t, "RESEND", receipt.Provider)
}
