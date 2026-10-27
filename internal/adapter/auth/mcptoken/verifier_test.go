package mcptoken

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newKeys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	return pub, priv
}

func sign(t *testing.T, priv ed25519.PrivateKey, c claims) string {
	t.Helper()
	s, err := jwtlib.NewWithClaims(jwtlib.SigningMethodEdDSA, c).SignedString(priv)
	require.NoError(t, err)
	return s
}

func valid(now time.Time) claims {
	return claims{
		RegisteredClaims: jwtlib.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwtlib.ClaimStrings{Audience},
			Subject:   "42",
			IssuedAt:  jwtlib.NewNumericDate(now),
			ExpiresAt: jwtlib.NewNumericDate(now.Add(time.Minute)),
		},
		Scope: auth.ScopeRead,
	}
}

func TestVerifyValid(t *testing.T) {
	pub, priv := newKeys(t)
	got, err := NewVerifier(pub).Verify(context.Background(), sign(t, priv, valid(time.Now())))
	require.NoError(t, err)
	assert.Equal(t, auth.MCPClaims{UserID: "42", Scope: auth.ScopeRead}, got)
}

func TestVerifyExpired(t *testing.T) {
	pub, priv := newKeys(t)
	v := NewVerifier(pub)
	tok := sign(t, priv, valid(time.Now()))
	v.now = func() time.Time { return time.Now().Add(time.Hour) }
	_, err := v.Verify(context.Background(), tok)
	assert.ErrorIs(t, err, auth.ErrTokenExpired)
}

func TestVerifyRejects(t *testing.T) {
	pub, priv := newKeys(t)
	_, otherPriv := newKeys(t)
	now := time.Now()
	mutate := func(f func(*claims)) string {
		c := valid(now)
		f(&c)
		return sign(t, priv, c)
	}
	hs, err := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, valid(now)).SignedString([]byte(pub))
	require.NoError(t, err)
	none, err := jwtlib.NewWithClaims(jwtlib.SigningMethodNone, valid(now)).SignedString(jwtlib.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	tests := map[string]string{
		"wrong key":         sign(t, otherPriv, valid(now)),
		"wrong issuer":      mutate(func(c *claims) { c.Issuer = "someone-else" }),
		"wrong audience":    mutate(func(c *claims) { c.Audience = jwtlib.ClaimStrings{"another-api"} }),
		"missing subject":   mutate(func(c *claims) { c.Subject = "" }),
		"missing scope":     mutate(func(c *claims) { c.Scope = "" }),
		"unknown scope":     mutate(func(c *claims) { c.Scope = "admin" }),
		"missing iat":       mutate(func(c *claims) { c.IssuedAt = nil }),
		"missing exp":       mutate(func(c *claims) { c.ExpiresAt = nil }),
		"lifetime too long": mutate(func(c *claims) { c.ExpiresAt = jwtlib.NewNumericDate(now.Add(time.Hour)) }),
		"hs256 with pubkey": hs,
		"alg none":          none,
		"garbage":           "not-a-jwt",
	}
	v := NewVerifier(pub)
	for name, tok := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := v.Verify(context.Background(), tok)
			assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
		})
	}
}

func TestParsePublicKey(t *testing.T) {
	pub, _ := newKeys(t)
	der, err := x509.MarshalPKIXPublicKey(pub)
	require.NoError(t, err)
	pemStr := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))

	for name, in := range map[string]string{
		"pem":    pemStr,
		"base64": base64.StdEncoding.EncodeToString(pub),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := ParsePublicKey(in)
			require.NoError(t, err)
			assert.True(t, pub.Equal(got))
		})
	}
	for name, in := range map[string]string{
		"empty":     "",
		"not b64":   "%%%",
		"too short": base64.StdEncoding.EncodeToString([]byte("short")),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ParsePublicKey(in)
			assert.Error(t, err)
		})
	}
}
