package mailing

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct{ templates map[string]Template }

func (r fakeRepo) FindByCode(_ context.Context, code string) (Template, error) {
	if t, ok := r.templates[code]; ok {
		return t, nil
	}
	return Template{}, ErrTemplateNotFound
}

type fakeSender struct {
	sent []Message
	err  error
}

func (s *fakeSender) Send(_ context.Context, m Message) (Receipt, error) {
	if s.err != nil {
		return Receipt{Provider: "FAKE"}, s.err
	}
	s.sent = append(s.sent, m)
	return Receipt{Provider: "FAKE", ProviderID: "id-1"}, nil
}

type fakeLogs struct {
	logs []EmailLog
	err  error
}

func (l *fakeLogs) Create(_ context.Context, e EmailLog) error {
	if l.err != nil {
		return l.err
	}
	l.logs = append(l.logs, e)
	return nil
}

var fixedNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func newSvc(t Template) (*Service, *fakeSender, *fakeLogs) {
	sender, logs := &fakeSender{}, &fakeLogs{}
	svc := NewService(fakeRepo{map[string]Template{t.Code: t}}, logs, sender, "https://app.example.com/")
	svc.now = func() time.Time { return fixedNow }
	return svc, sender, logs
}

var hello = Template{
	ID:       9,
	Code:     TemplateWelcome,
	Subject:  "Hi {{.Name}}",
	BodyHTML: `<a href="{{.AppURL}}">{{.Name}}</a>`,
	BodyText: "Hi {{.Name}} {{.AppURL}}",
}

var ctx = context.Background()

func TestSendRendersTemplate(t *testing.T) {
	svc, sender, _ := newSvc(hello)
	require.NoError(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}}))
	require.Len(t, sender.sent, 1)
	assert.Equal(t, Message{
		To:      "ana@x.com",
		Subject: "Hi Ana",
		HTML:    `<a href="https://app.example.com">Ana</a>`,
		Text:    "Hi Ana https://app.example.com",
	}, sender.sent[0])
}

func TestSendPassesCopiesToTheProvider(t *testing.T) {
	svc, sender, _ := newSvc(hello)
	require.NoError(t, svc.Send(ctx, Request{
		Code: TemplateWelcome, To: "ana@x.com", CC: []string{"boss@x.com"}, BCC: []string{"audit@x.com"},
		Data: map[string]string{"Name": "Ana"},
	}))
	assert.Equal(t, []string{"boss@x.com"}, sender.sent[0].CC)
	assert.Equal(t, []string{"audit@x.com"}, sender.sent[0].BCC)
}

func TestSendEscapesHTMLValues(t *testing.T) {
	svc, sender, _ := newSvc(hello)
	require.NoError(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "<script>x</script>"}}))
	assert.NotContains(t, sender.sent[0].HTML, "<script>")
}

func TestSendLogsTheProviderIDOnSuccess(t *testing.T) {
	svc, _, logs := newSvc(hello)
	require.NoError(t, svc.Send(ctx, Request{
		Code: TemplateWelcome, To: "ana@x.com", CC: []string{"boss@x.com"}, BCC: []string{"audit@x.com"},
		Data: map[string]string{"Name": "Ana"},
	}))
	require.Len(t, logs.logs, 1)
	assert.Equal(t, EmailLog{
		TemplateID: 9, To: "ana@x.com", CC: []string{"boss@x.com"}, BCC: []string{"audit@x.com"},
		Status: LogSent, Provider: "FAKE", ProviderID: "id-1", CreatedAt: fixedNow,
	}, logs.logs[0])
}

func TestSendLogsTheProviderErrorOnFailure(t *testing.T) {
	svc, sender, logs := newSvc(hello)
	sender.err = errors.New("provider down")

	err := svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}})
	assert.ErrorIs(t, err, sender.err)
	require.Len(t, logs.logs, 1)
	assert.Equal(t, LogFailed, logs.logs[0].Status)
	assert.Equal(t, "FAKE", logs.logs[0].Provider)
	assert.Empty(t, logs.logs[0].ProviderID)
	assert.Equal(t, ErrorTypeUnknown, logs.logs[0].Error.Type, "a plain error says nothing about its origin")
	assert.Equal(t, "provider down", logs.logs[0].Error.Message)
}

func TestSendLogsTheTypeCodeAndMessageOfAProviderError(t *testing.T) {
	svc, sender, logs := newSvc(hello)
	sender.err = &ProviderError{Type: ErrorTypeRateLimit, Code: "rate_limit_exceeded", Message: "Too many requests"}

	err := svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}})
	var pe *ProviderError
	require.ErrorAs(t, err, &pe)
	require.Len(t, logs.logs, 1)
	assert.Equal(t, &ProviderError{Type: ErrorTypeRateLimit, Code: "rate_limit_exceeded", Message: "Too many requests"}, logs.logs[0].Error)
}

func TestSendLogsAWrappedProviderError(t *testing.T) {
	svc, sender, logs := newSvc(hello)
	sender.err = fmt.Errorf("wrapped: %w", &ProviderError{Type: ErrorTypeAuth, Code: "invalid_api_key", Message: "API key is invalid"})

	require.Error(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}}))
	assert.Equal(t, ErrorTypeAuth, logs.logs[0].Error.Type)
	assert.Equal(t, "invalid_api_key", logs.logs[0].Error.Code)
}

func TestProviderErrorText(t *testing.T) {
	assert.Equal(t, "validation (validation_error): bad from", (&ProviderError{Type: ErrorTypeValidation, Code: "validation_error", Message: "bad from"}).Error())
	assert.Equal(t, "network: timeout", (&ProviderError{Type: ErrorTypeNetwork, Message: "timeout"}).Error())
}

func TestSendReportsALogFailureWithoutHidingTheSendResult(t *testing.T) {
	svc, sender, logs := newSvc(hello)
	logs.err = errors.New("db down")

	err := svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}})
	assert.ErrorIs(t, err, logs.err)
	assert.Len(t, sender.sent, 1, "the email went out anyway")

	sender.err = errors.New("provider down")
	err = svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}})
	assert.ErrorIs(t, err, sender.err)
	assert.ErrorIs(t, err, logs.err)
}

func TestSendLogsEvenIfTheRequestContextIsCancelled(t *testing.T) {
	svc, _, logs := newSvc(hello)
	cctx, cancel := context.WithCancel(ctx)
	svc.sender = cancelingSender{cancel: cancel}
	require.NoError(t, svc.Send(cctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{"Name": "Ana"}}))
	assert.Len(t, logs.logs, 1)
}

type cancelingSender struct{ cancel func() }

func (s cancelingSender) Send(context.Context, Message) (Receipt, error) {
	s.cancel()
	return Receipt{Provider: "FAKE", ProviderID: "id-2"}, nil
}

func TestSendRejectsWithoutLogging(t *testing.T) {
	svc, sender, logs := newSvc(hello)
	data := map[string]string{"Name": "Ana"}

	assert.ErrorIs(t, svc.Send(ctx, Request{Code: TemplateLogin, To: "ana@x.com", Data: data}), ErrTemplateNotFound)
	assert.ErrorIs(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "not-an-email", Data: data}), ErrInvalidRecipient)
	assert.ErrorIs(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "Ana <ana@x.com>", Data: data}), ErrInvalidRecipient)
	assert.ErrorIs(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", CC: []string{"bad"}, Data: data}), ErrInvalidRecipient)
	assert.ErrorIs(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", BCC: []string{"bad"}, Data: data}), ErrInvalidRecipient)
	assert.Error(t, svc.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com", Data: map[string]string{}}), "missing Name must fail, not render empty")
	assert.Empty(t, sender.sent)
	assert.Empty(t, logs.logs, "nothing reached the provider, so nothing is logged")
}

type failingMailer struct{ called chan struct{} }

func (m failingMailer) Send(context.Context, Request) error {
	defer close(m.called)
	return errors.New("provider down")
}

func TestAsyncNeverReturnsErrorsAndSurvivesCancelledContext(t *testing.T) {
	m := failingMailer{called: make(chan struct{})}
	a := NewAsync(m)
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	assert.NoError(t, a.Send(cctx, Request{Code: TemplateWelcome, To: "ana@x.com"}))
	a.Wait()
	select {
	case <-m.called:
	case <-time.After(time.Second):
		t.Fatal("mailer was not called")
	}
}

type blockingMailer struct{ release chan struct{} }

func (m blockingMailer) Send(context.Context, Request) error {
	<-m.release
	return nil
}

func TestAsyncDoesNotBlockTheCaller(t *testing.T) {
	m := blockingMailer{release: make(chan struct{})}
	a := NewAsync(m)
	done := make(chan struct{})
	go func() {
		_ = a.Send(ctx, Request{Code: TemplateWelcome, To: "ana@x.com"})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Send blocked on a slow provider")
	}
	close(m.release)
	a.Wait()
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestClockAdvancesAndIsUTC(t *testing.T) {
	s := NewService(nil, nil, nil, "")
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}
