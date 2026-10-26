// Package google implements user.GoogleVerifier with Google's ID token validation.
package google

import (
	"context"
	"errors"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"google.golang.org/api/idtoken"
)

// validator is the part of *idtoken.Validator the adapter uses.
type validator interface {
	Validate(ctx context.Context, idToken, audience string) (*idtoken.Payload, error)
}

type Verifier struct {
	validator validator
	clientID  string
}

// NewVerifier accepts only tokens issued for clientID, your Google OAuth client id.
func NewVerifier(ctx context.Context, clientID string) (*Verifier, error) {
	if clientID == "" {
		return nil, errors.New("google: client id is required")
	}
	v, err := idtoken.NewValidator(ctx)
	if err != nil {
		return nil, fmt.Errorf("google: validator: %w", err)
	}
	return &Verifier{validator: v, clientID: clientID}, nil
}

func (v *Verifier) Verify(ctx context.Context, idToken string) (user.GoogleIdentity, error) {
	// The library checks signature, expiry and audience, but not the issuer.
	p, err := v.validator.Validate(ctx, idToken, v.clientID)
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
