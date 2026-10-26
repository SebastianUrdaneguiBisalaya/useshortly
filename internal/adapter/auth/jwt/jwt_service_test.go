package jwt

import (
	"context"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const secret = "0123456789abcdef0123456789abcdef"

func TestGenerateAndValidate(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	tok, err := svc.Generate(context.Background(), "42")
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().Add(time.Hour), tok.ExpiresAt, 5*time.Second)

	id, err := svc.Validate(context.Background(), tok.Value)
	require.NoError(t, err)
	assert.Equal(t, "42", id)
}

func TestValidateExpired(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	tok, err := svc.Generate(context.Background(), "42")
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	_, err = svc.Validate(context.Background(), tok.Value)
	assert.ErrorIs(t, err, auth.ErrTokenExpired)
}

func TestValidateRejects(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	other, err := NewJwtService("another-secret-another-secret-0000", time.Hour).Generate(context.Background(), "42")
	require.NoError(t, err)
	none, err := jwtlib.NewWithClaims(jwtlib.SigningMethodNone, jwtlib.RegisteredClaims{
		Subject:   "42",
		ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString(jwtlib.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)
	noExp, err := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, jwtlib.RegisteredClaims{Subject: "42"}).SignedString([]byte(secret))
	require.NoError(t, err)
	noSub, err := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, jwtlib.RegisteredClaims{
		ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString([]byte(secret))
	require.NoError(t, err)

	for name, token := range map[string]string{
		"wrong secret":  other.Value,
		"alg none":      none,
		"no expiration": noExp,
		"no subject":    noSub,
		"garbage":       "not-a-jwt",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.Validate(context.Background(), token)
			assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
		})
	}
}
