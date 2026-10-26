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

type Auth struct {
	validator    validator
	client       *http.Client
	tokenURL     string
	clientID     string
	clientSecret string
	redirectURI  string
}

// New needs the OAuth client id and secret from the Google console. The secret is only
// used here, in the server-to-server call that trades the code for tokens; the id token
// that comes back is then verified with Google's public keys. redirectURI must match what
// the client used to get the code ("postmessage" for Google's JavaScript popup flow).
func New(ctx context.Context, clientID, clientSecret, redirectURI string) (*Auth, error) {
	if clientID == "" || clientSecret == "" {
		return nil, errors.New("google: client id and client secret are required")
	}
	v, err := idtoken.NewValidator(ctx)
	if err != nil {
		return nil, fmt.Errorf("google: validator: %w", err)
	}
	return &Auth{
		validator: v, client: &http.Client{Timeout: 10 * time.Second}, tokenURL: tokenURL,
		clientID: clientID, clientSecret: clientSecret, redirectURI: redirectURI,
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
// the user's identity with the scope they granted. A rejected code (expired, reused, issued
// for another client) is auth.ErrInvalidCredentials; anything else is a real failure.
func (a *Auth) Exchange(ctx context.Context, code string) (user.GoogleIdentity, error) {
	if code == "" {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	form := url.Values{
		"code":          {code},
		"client_id":     {a.clientID},
		"client_secret": {a.clientSecret},
		"redirect_uri":  {a.redirectURI},
		"grant_type":    {"authorization_code"},
	}
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
	p, err := a.validator.Validate(ctx, tr.IDToken, a.clientID)
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
