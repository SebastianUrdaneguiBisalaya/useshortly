package mailing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	htmltemplate "html/template"
	"net/mail"
	"strings"
	texttemplate "text/template"
	"time"
)

type Service struct {
	repo   TemplateRepository
	logs   LogRepository
	sender Sender
	appURL string
	now    func() time.Time
}

// NewService renders templates, hands them to sender and records every attempt in logs.
// appURL is exposed to every template as {{.AppURL}}.
func NewService(repo TemplateRepository, logs LogRepository, sender Sender, appURL string) *Service {
	return &Service{repo: repo, logs: logs, sender: sender, appURL: strings.TrimRight(appURL, "/"), now: func() time.Time { return time.Now().UTC() }}
}

// Send renders the template identified by req.Code with req.Data and sends it. A template
// that references a key missing from the data is an error, not an empty string.
//
// Once the email reaches the provider the attempt is logged either way: SENT with the id
// the provider returned, or FAILED with its error. The send error is what Send returns; a
// failure to write the log is returned too (joined) but never hides it.
func (s *Service) Send(ctx context.Context, req Request) error {
	for _, addr := range append(append([]string{req.To}, req.CC...), req.BCC...) {
		if a, err := mail.ParseAddress(addr); err != nil || a.Address != addr {
			return ErrInvalidRecipient
		}
	}
	t, err := s.repo.FindByCode(ctx, req.Code)
	if err != nil {
		return err
	}
	vars := make(map[string]string, len(req.Data)+1)
	for k, v := range req.Data {
		vars[k] = v
	}
	vars["AppURL"] = s.appURL

	subject, err := renderText(t.Code+" subject", t.Subject, vars)
	if err != nil {
		return err
	}
	text, err := renderText(t.Code+" text", t.BodyText, vars)
	if err != nil {
		return err
	}
	html, err := renderHTML(t.Code+" html", t.BodyHTML, vars)
	if err != nil {
		return err
	}

	receipt, sendErr := s.sender.Send(ctx, Message{
		To: req.To, CC: req.CC, BCC: req.BCC, Subject: subject, HTML: html, Text: text,
	})
	entry := EmailLog{
		TemplateID: t.ID, To: req.To, CC: req.CC, BCC: req.BCC,
		Status: LogSent, Provider: receipt.Provider, ProviderID: receipt.ProviderID,
		CreatedAt: s.now(),
	}
	if sendErr != nil {
		entry.Status, entry.ProviderID, entry.Error = LogFailed, "", asProviderError(sendErr)
	}
	// The send already happened: log with a context that survives a cancelled request.
	logErr := s.logs.Create(context.WithoutCancel(ctx), entry)
	return errors.Join(sendErr, logErr)
}

func renderText(name, body string, vars map[string]string) (string, error) {
	t, err := texttemplate.New(name).Option("missingkey=error").Parse(body)
	if err != nil {
		return "", fmt.Errorf("mailing: parse %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		return "", fmt.Errorf("mailing: render %s: %w", name, err)
	}
	return buf.String(), nil
}

// renderHTML escapes every value, so names or organization names cannot inject markup.
func renderHTML(name, body string, vars map[string]string) (string, error) {
	t, err := htmltemplate.New(name).Option("missingkey=error").Parse(body)
	if err != nil {
		return "", fmt.Errorf("mailing: parse %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		return "", fmt.Errorf("mailing: render %s: %w", name, err)
	}
	return buf.String(), nil
}
