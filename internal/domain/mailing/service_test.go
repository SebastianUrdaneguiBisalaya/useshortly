package mailing

import (
	"context"
	"errors"
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

func (s *fakeSender) Send(_ context.Context, m Message) error {
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, m)
	return nil
}

func newSvc(t Template) (*Service, *fakeSender) {
	sender := &fakeSender{}
	return NewService(fakeRepo{map[string]Template{t.Code: t}}, sender, "https://app.example.com/"), sender
}

var hello = Template{
	Code:     TemplateWelcome,
	Subject:  "Hi {{.Name}}",
	BodyHTML: `<a href="{{.AppURL}}">{{.Name}}</a>`,
	BodyText: "Hi {{.Name}} {{.AppURL}}",
}

func TestSendRendersTemplate(t *testing.T) {
	svc, sender := newSvc(hello)
	require.NoError(t, svc.Send(context.Background(), TemplateWelcome, "ana@x.com", map[string]string{"Name": "Ana"}))
	require.Len(t, sender.sent, 1)
	assert.Equal(t, Message{
		To:      "ana@x.com",
		Subject: "Hi Ana",
		HTML:    `<a href="https://app.example.com">Ana</a>`,
		Text:    "Hi Ana https://app.example.com",
	}, sender.sent[0])
}

func TestSendEscapesHTMLValues(t *testing.T) {
	svc, sender := newSvc(hello)
	require.NoError(t, svc.Send(context.Background(), TemplateWelcome, "ana@x.com", map[string]string{"Name": "<script>x</script>"}))
	assert.NotContains(t, sender.sent[0].HTML, "<script>")
}

func TestSendErrors(t *testing.T) {
	ctx := context.Background()
	svc, sender := newSvc(hello)

	assert.ErrorIs(t, svc.Send(ctx, TemplateLogin, "ana@x.com", nil), ErrTemplateNotFound)
	assert.ErrorIs(t, svc.Send(ctx, TemplateWelcome, "not-an-email", nil), ErrInvalidRecipient)
	assert.ErrorIs(t, svc.Send(ctx, TemplateWelcome, "Ana <ana@x.com>", nil), ErrInvalidRecipient)
	assert.Error(t, svc.Send(ctx, TemplateWelcome, "ana@x.com", map[string]string{}), "missing Name must fail, not render empty")
	assert.Empty(t, sender.sent)

	boom := errors.New("provider down")
	sender.err = boom
	assert.ErrorIs(t, svc.Send(ctx, TemplateWelcome, "ana@x.com", map[string]string{"Name": "Ana"}), boom)
}

type failingMailer struct{ called chan struct{} }

func (m failingMailer) Send(context.Context, string, string, map[string]string) error {
	defer close(m.called)
	return errors.New("provider down")
}

func TestAsyncNeverReturnsErrorsAndSurvivesCancelledContext(t *testing.T) {
	m := failingMailer{called: make(chan struct{})}
	a := NewAsync(m)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.NoError(t, a.Send(ctx, TemplateWelcome, "ana@x.com", nil))
	a.Wait()
	select {
	case <-m.called:
	case <-time.After(time.Second):
		t.Fatal("mailer was not called")
	}
}

type blockingMailer struct{ release chan struct{} }

func (m blockingMailer) Send(ctx context.Context, _, _ string, _ map[string]string) error {
	<-m.release
	return nil
}

func TestAsyncDoesNotBlockTheCaller(t *testing.T) {
	m := blockingMailer{release: make(chan struct{})}
	a := NewAsync(m)
	done := make(chan struct{})
	go func() {
		_ = a.Send(context.Background(), TemplateWelcome, "ana@x.com", nil)
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
