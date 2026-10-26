package google

import (
	"context"
	"errors"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/idtoken"
)

type fakeValidator struct {
	payload  *idtoken.Payload
	err      error
	audience string
}

func (f *fakeValidator) Validate(_ context.Context, _, audience string) (*idtoken.Payload, error) {
	f.audience = audience
	return f.payload, f.err
}

func payload(issuer string, claims map[string]any) *idtoken.Payload {
	return &idtoken.Payload{Issuer: issuer, Subject: "g-123", Claims: claims}
}

func TestVerifyMapsClaims(t *testing.T) {
	f := &fakeValidator{payload: payload("https://accounts.google.com", map[string]any{
		"email": "ana@example.com", "email_verified": true,
		"given_name": "Ana", "family_name": "Lopez", "picture": "https://img/a.png",
	})}
	v := &Verifier{validator: f, clientID: "client-1"}

	id, err := v.Verify(context.Background(), "token")
	require.NoError(t, err)
	assert.Equal(t, user.GoogleIdentity{
		Subject: "g-123", Email: "ana@example.com", EmailVerified: true,
		FirstName: "Ana", LastName: "Lopez", PictureURL: "https://img/a.png",
	}, id)
	assert.Equal(t, "client-1", f.audience, "the token must be issued for our client id")
}

func TestVerifyAcceptsBothIssuerForms(t *testing.T) {
	for _, iss := range []string{"accounts.google.com", "https://accounts.google.com"} {
		v := &Verifier{validator: &fakeValidator{payload: payload(iss, nil)}, clientID: "c"}
		_, err := v.Verify(context.Background(), "t")
		assert.NoError(t, err, iss)
	}
}

func TestVerifyRejectsOtherIssuers(t *testing.T) {
	v := &Verifier{validator: &fakeValidator{payload: payload("https://evil.example.com", nil)}, clientID: "c"}
	_, err := v.Verify(context.Background(), "t")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestVerifyMapsValidationErrors(t *testing.T) {
	v := &Verifier{validator: &fakeValidator{err: errors.New("idtoken: token expired")}, clientID: "c"}
	_, err := v.Verify(context.Background(), "t")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestEmailVerifiedForms(t *testing.T) {
	for want, claims := range map[bool]map[string]any{
		true:  {"email_verified": true},
		false: {"email_verified": false},
	} {
		assert.Equal(t, want, verified(payload("", claims)))
	}
	assert.True(t, verified(payload("", map[string]any{"email_verified": "true"})))
	assert.False(t, verified(payload("", map[string]any{"email_verified": "false"})))
	assert.False(t, verified(payload("", map[string]any{})), "missing means not verified")
	assert.False(t, verified(payload("", map[string]any{"email_verified": 1.0})))
}

func TestNewVerifierRequiresClientID(t *testing.T) {
	_, err := NewVerifier(context.Background(), "")
	assert.Error(t, err)
}
