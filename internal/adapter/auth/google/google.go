// Package google implements user.GoogleAuth with Google's OAuth 2.0 authorization code flow.
package google

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"google.golang.org/api/idtoken"
)

const tokenURL = "https://oauth2.googleapis.com/token"

// validator is the part of *idtoken.Validator the adapter uses.
type validator interface {
	Validate(ctx context.Context, idToken, audience string) (*idtoken.Payload, error)
}

// Client is an OAuth client registered in the Google console.
type Client struct {
	ID     string
	Secret string
}

type Auth struct {
	validator   validator
	client      *http.Client
	tokenURL    string
	web         Client
	redirectURI string
	// desktop is the "Desktop app" client the desktop app signs in with; zero when not configured.
	desktop Client
}

// New needs the OAuth clients from the Google console. The secrets are only used here, in the
// server-to-server call that trades the code for tokens; the id token that comes back is then
// verified with Google's public keys. redirectURI must match what the web app used to get the
// code ("postmessage" for Google's JavaScript popup flow). desktop is optional: it is the
// "Desktop app" client, which accepts the loopback redirects the desktop app uses.
func New(ctx context.Context, web Client, redirectURI string, desktop Client) (*Auth, error) {
	if web.ID == "" || web.Secret == "" {
		return nil, errors.New("google: client id and client secret are required")
	}
	if (desktop.ID == "") != (desktop.Secret == "") {
		return nil, errors.New("google: desktop client id and client secret must be set together")
	}
	v, err := idtoken.NewValidator(ctx)
	if err != nil {
		return nil, fmt.Errorf("google: validator: %w", err)
	}
	return &Auth{
		validator: v, client: &http.Client{Timeout: 10 * time.Second}, tokenURL: tokenURL,
		web: web, redirectURI: redirectURI, desktop: desktop,
	}, nil
}

type tokenResponse struct {
	IDToken string `json:"id_token"`
	Scope   string `json:"scope"`
}

type tokenError struct {
	Error       string `json:"error"`
	Description string `json:"error_description"`
}

// Exchange trades the authorization code for tokens, verifies the id token and returns
// the user's identity with the scope they granted. A grant without a redirect URI comes from
// the web app's popup; one with a loopback redirect URI and a PKCE verifier comes from the
// desktop app and is exchanged with the desktop client. A rejected grant (expired or reused
// code, a redirect URI that is not loopback, a missing verifier) is auth.ErrInvalidCredentials;
// anything else is a real failure.
func (a *Auth) Exchange(ctx context.Context, grant user.GoogleGrant) (user.GoogleIdentity, error) {
	if grant.Code == "" {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	c, form := a.web, url.Values{"redirect_uri": {a.redirectURI}}
	if grant.RedirectURI != "" {
		if !loopback(grant.RedirectURI) || !validVerifier(grant.CodeVerifier) {
			return user.GoogleIdentity{}, auth.ErrInvalidCredentials
		}
		if a.desktop.ID == "" {
			return user.GoogleIdentity{}, errors.New("google: desktop sign-in needs GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET")
		}
		c, form = a.desktop, url.Values{"redirect_uri": {grant.RedirectURI}, "code_verifier": {grant.CodeVerifier}}
	}
	form.Set("code", grant.Code)
	form.Set("client_id", c.ID)
	form.Set("client_secret", c.Secret)
	form.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return user.GoogleIdentity{}, fmt.Errorf("google: token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client.Do(req)
	if err != nil {
		return user.GoogleIdentity{}, fmt.Errorf("google: token request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return user.GoogleIdentity{}, fmt.Errorf("google: token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e tokenError
		_ = json.Unmarshal(body, &e)
		if e.Error == "invalid_grant" {
			return user.GoogleIdentity{}, auth.ErrInvalidCredentials
		}
		// invalid_client, redirect_uri_mismatch... are our configuration, not the user's fault.
		return user.GoogleIdentity{}, fmt.Errorf("google: token endpoint answered %d: %s %s", resp.StatusCode, e.Error, e.Description)
	}
	var tr tokenResponse
	if err := json.Unmarshal(body, &tr); err != nil || tr.IDToken == "" {
		return user.GoogleIdentity{}, fmt.Errorf("google: token response has no id_token")
	}

	// The library checks signature, expiry and audience, but not the issuer.
	p, err := a.validator.Validate(ctx, tr.IDToken, c.ID)
	if err != nil {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	if p.Issuer != "accounts.google.com" && p.Issuer != "https://accounts.google.com" {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	return user.GoogleIdentity{
		Subject:       p.Subject,
		Email:         claim(p, "email"),
		EmailVerified: verified(p),
		FirstName:     claim(p, "given_name"),
		LastName:      claim(p, "family_name"),
		PictureURL:    claim(p, "picture"),
		Scope:         tr.Scope,
	}, nil
}

// loopback reports whether uri is an http redirect to the loopback interface, the only kind
// the desktop app listens on (RFC 8252 section 7.3). localhost is refused on purpose: it can
// resolve to something else.
func loopback(uri string) bool {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "http" || u.Port() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
}

// validVerifier checks the shape RFC 7636 section 4.1 gives a PKCE code verifier.
func validVerifier(v string) bool {
	if len(v) < 43 || len(v) > 128 {
		return false
	}
	for _, r := range v {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune("-._~", r)) {
			return false
		}
	}
	return true
}

func claim(p *idtoken.Payload, name string) string {
	s, _ := p.Claims[name].(string)
	return s
}

// email_verified is a JSON boolean, but some Google tokens carry it as the string "true".
func verified(p *idtoken.Payload) bool {
	switch v := p.Claims["email_verified"].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}
