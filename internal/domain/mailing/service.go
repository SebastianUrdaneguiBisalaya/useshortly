package mailing

import (
	"bytes"
	"context"
	"fmt"
	htmltemplate "html/template"
	"net/mail"
	"strings"
	texttemplate "text/template"
)

type Service struct {
	repo   TemplateRepository
	sender Sender
	appURL string
}

// NewService renders templates and hands them to sender. appURL is exposed to every
// template as {{.AppURL}}.
func NewService(repo TemplateRepository, sender Sender, appURL string) *Service {
	return &Service{repo: repo, sender: sender, appURL: strings.TrimRight(appURL, "/")}
}

// Send renders the template identified by code with data and sends it to the recipient.
// A template that references a key missing from data is an error, not an empty string.
func (s *Service) Send(ctx context.Context, code, to string, data map[string]string) error {
	if addr, err := mail.ParseAddress(to); err != nil || addr.Address != to {
		return ErrInvalidRecipient
	}
	t, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return err
	}
	vars := make(map[string]string, len(data)+1)
	for k, v := range data {
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
	return s.sender.Send(ctx, Message{To: to, Subject: subject, HTML: html, Text: text})
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
