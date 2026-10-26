package resend

import (
	"context"
	"encoding/json"
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

func providerError(t *testing.T, err error) *mailing.ProviderError {
	t.Helper()
	var pe *mailing.ProviderError
	require.ErrorAs(t, err, &pe)
	return pe
}

func failWith(status int, body string, headers map[string]string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

var msg = mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "Hi"}

func TestSendValidationErrorKeepsTypeCodeAndMessage(t *testing.T) {
	s := newTestSender(t, failWith(http.StatusUnprocessableEntity,
		`{"statusCode":422,"name":"validation_error","message":"The from address is invalid"}`, nil))
	receipt, err := s.Send(context.Background(), msg)
	require.Error(t, err)
	assert.Equal(t, mailing.Receipt{Provider: "RESEND"}, receipt, "no id, but the provider is known")
	pe := providerError(t, err)
	assert.Equal(t, mailing.ErrorTypeValidation, pe.Type)
	assert.Equal(t, "validation_error", pe.Code, "the name the SDK throws away")
	assert.Equal(t, "The from address is invalid", pe.Message)
}

func TestSendClassifiesByStatus(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		kind   mailing.ErrorType
		code   string
	}{
		{400, `{"statusCode":400,"name":"missing_required_field","message":"Missing ` + "`to`" + ` field"}`, mailing.ErrorTypeValidation, "missing_required_field"},
		{401, `{"statusCode":401,"name":"missing_api_key","message":"Missing API key"}`, mailing.ErrorTypeAuth, "missing_api_key"},
		{403, `{"statusCode":403,"name":"invalid_api_key","message":"API key is invalid"}`, mailing.ErrorTypeAuth, "invalid_api_key"},
		{500, `{"statusCode":500,"name":"application_error","message":"Internal error"}`, mailing.ErrorTypeProvider, "application_error"},
		{502, `not json at all`, mailing.ErrorTypeProvider, "502"},
	} {
		s := newTestSender(t, failWith(tc.status, tc.body, nil))
		_, err := s.Send(context.Background(), msg)
		pe := providerError(t, err)
		assert.Equal(t, tc.kind, pe.Type, tc.status)
		assert.Equal(t, tc.code, pe.Code, tc.status)
		assert.NotEmpty(t, pe.Message, tc.status)
	}
}

func TestSendRateLimit(t *testing.T) {
	s := newTestSender(t, failWith(http.StatusTooManyRequests,
		`{"statusCode":429,"name":"rate_limit_exceeded","message":"Too many requests"}`, map[string]string{"retry-after": "7"}))
	receipt, err := s.Send(context.Background(), msg)
	pe := providerError(t, err)
	assert.Equal(t, mailing.ErrorTypeRateLimit, pe.Type)
	assert.Equal(t, "rate_limit_exceeded", pe.Code)
	assert.Equal(t, "Too many requests (retry after 7s)", pe.Message)
	assert.ErrorIs(t, err, resendlib.ErrRateLimit, "the SDK error stays reachable")
	assert.Equal(t, "RESEND", receipt.Provider)
	assert.Empty(t, receipt.ProviderID)
}

func TestSendNetworkFailure(t *testing.T) {
	s := newTestSender(t, func(http.ResponseWriter, *http.Request) {})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	receipt, err := s.Send(ctx, msg)
	pe := providerError(t, err)
	assert.Equal(t, mailing.ErrorTypeNetwork, pe.Type)
	assert.Empty(t, pe.Code)
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, "RESEND", receipt.Provider)
}

func TestConcurrentSendsDoNotMixUpTheirErrors(t *testing.T) {
	s := newTestSender(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Subject string `json:"subject"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Subject == "bad" {
			failWith(http.StatusUnprocessableEntity, `{"name":"validation_error","message":"bad one"}`, nil)(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"ok"}`))
	})
	done := make(chan struct{}, 40)
	for i := range 40 {
		go func() {
			defer func() { done <- struct{}{} }()
			m := msg
			m.Subject = "good"
			if i%2 == 0 {
				m.Subject = "bad"
			}
			receipt, err := s.Send(context.Background(), m)
			if i%2 == 0 {
				var pe *mailing.ProviderError
				assert.ErrorAs(t, err, &pe)
				assert.Equal(t, "bad one", pe.Message)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, "ok", receipt.ProviderID)
			}
		}()
	}
	for range 40 {
		<-done
	}
}
