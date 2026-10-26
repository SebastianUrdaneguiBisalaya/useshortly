// Package resend implements mailing.Sender with the Resend API.
package resend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	resendlib "github.com/resend/resend-go/v4"
)

// Provider is the name stored in email_logs.email_provider.
const Provider = "RESEND"

type Sender struct {
	client *resendlib.Client
	from   string
}

// New returns a Sender that sends as from (e.g. "useshortly <no-reply@example.com>").
func New(apiKey, from string) *Sender {
	// The SDK keeps only the "message" of an error body (it drops statusCode and name),
	// so a transport records the failed answer to rebuild the full error from it.
	httpClient := &http.Client{Timeout: 15 * time.Second, Transport: captureTransport{base: http.DefaultTransport}}
	return &Sender{client: resendlib.NewCustomClient(httpClient, apiKey), from: from}
}

// Send posts the email to Resend. On success the receipt carries the id Resend assigns
// ({"id": "..."} in its 2xx answer). On failure the receipt still names the provider and
// the error is a *mailing.ProviderError.
func (s *Sender) Send(ctx context.Context, m mailing.Message) (mailing.Receipt, error) {
	receipt := mailing.Receipt{Provider: Provider}
	failed := &failedAnswer{}
	res, err := s.client.Emails.SendWithContext(context.WithValue(ctx, failedKey{}, failed), &resendlib.SendEmailRequest{
		From:    s.from,
		To:      []string{m.To},
		Cc:      m.CC,
		Bcc:     m.BCC,
		Subject: m.Subject,
		Html:    m.HTML,
		Text:    m.Text,
	})
	if err != nil {
		return receipt, classify(err, failed)
	}
	receipt.ProviderID = res.Id
	return receipt, nil
}

// failedAnswer is a non-2xx answer as Resend sent it.
type failedAnswer struct {
	status     int
	body       []byte
	retryAfter string
}

type failedKey struct{}

type captureTransport struct{ base http.RoundTripper }

func (t captureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := t.base.RoundTrip(req)
	if err != nil || resp.StatusCode < 300 {
		return resp, err
	}
	if f, ok := req.Context().Value(failedKey{}).(*failedAnswer); ok {
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(body)) // the SDK still reads it
		if readErr == nil {
			f.status, f.body, f.retryAfter = resp.StatusCode, body, resp.Header.Get("retry-after")
		}
	}
	return resp, nil
}

// classify turns the SDK error, plus the recorded answer if there was one, into a
// *mailing.ProviderError. Resend's error body is {"statusCode", "name", "message"}.
func classify(err error, f *failedAnswer) *mailing.ProviderError {
	if f.status == 0 { // no HTTP answer at all
		var netErr net.Error
		var urlErr *url.Error
		kind := mailing.ErrorTypeUnknown
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
			errors.As(err, &netErr) || errors.As(err, &urlErr) {
			kind = mailing.ErrorTypeNetwork
		}
		return &mailing.ProviderError{Type: kind, Message: err.Error(), Err: fmt.Errorf("resend: send: %w", err)}
	}
	var body struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(f.body, &body)
	if body.Message == "" {
		body.Message = http.StatusText(f.status)
	}
	if body.Name == "" {
		body.Name = strconv.Itoa(f.status)
	}
	kind := mailing.ErrorTypeProvider
	switch f.status {
	case http.StatusTooManyRequests:
		kind = mailing.ErrorTypeRateLimit
		if f.retryAfter != "" {
			body.Message += " (retry after " + f.retryAfter + "s)"
		}
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		kind = mailing.ErrorTypeValidation
	case http.StatusUnauthorized, http.StatusForbidden:
		kind = mailing.ErrorTypeAuth
	}
	return &mailing.ProviderError{Type: kind, Code: body.Name, Message: body.Message, Err: fmt.Errorf("resend: send: %w", err)}
}
