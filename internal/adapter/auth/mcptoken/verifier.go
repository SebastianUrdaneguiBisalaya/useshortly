// Package mcptoken implements auth.MCPTokenVerifier with EdDSA (Ed25519) JWTs.
package mcptoken

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
)

const (
	// Issuer and Audience are fixed: a token minted for anything else is refused.
	Issuer   = "useshortly-mcp"
	Audience = "useshortly-api"
	// maxLifetime caps exp-iat, so a leaked or misconfigured signer cannot mint long-lived tokens.
	maxLifetime = 5 * time.Minute
)

type claims struct {
	jwtlib.RegisteredClaims
	Scope string `json:"scope"`
}

type Verifier struct {
	key ed25519.PublicKey
	now func() time.Time
}

func NewVerifier(key ed25519.PublicKey) *Verifier {
	return &Verifier{key: key, now: time.Now}
}

// ParsePublicKey reads an Ed25519 public key from a PKIX PEM block or from the base64 of its
// raw 32 bytes, so it fits in a single env var.
func ParsePublicKey(s string) (ed25519.PublicKey, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("mcptoken: empty public key")
	}
	if block, _ := pem.Decode([]byte(s)); block != nil {
		pub, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("mcptoken: parse PEM public key: %w", err)
		}
		key, ok := pub.(ed25519.PublicKey)
		if !ok {
			return nil, errors.New("mcptoken: public key is not Ed25519")
		}
		return key, nil
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("mcptoken: public key is neither PEM nor base64: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("mcptoken: raw public key must be %d bytes, got %d", ed25519.PublicKeySize, len(raw))
	}
	return ed25519.PublicKey(raw), nil
}

func (v *Verifier) Verify(_ context.Context, tokenString string) (auth.MCPClaims, error) {
	c := &claims{}
	token, err := jwtlib.ParseWithClaims(
		tokenString,
		c,
		func(*jwtlib.Token) (any, error) { return v.key, nil },
		jwtlib.WithValidMethods([]string{jwtlib.SigningMethodEdDSA.Alg()}),
		jwtlib.WithIssuer(Issuer),
		jwtlib.WithAudience(Audience),
		jwtlib.WithExpirationRequired(),
		jwtlib.WithIssuedAt(),
		jwtlib.WithTimeFunc(v.now),
	)
	if errors.Is(err, jwtlib.ErrTokenExpired) {
		return auth.MCPClaims{}, auth.ErrTokenExpired
	}
	if err != nil || !token.Valid || c.Subject == "" || c.IssuedAt == nil || c.ExpiresAt == nil {
		return auth.MCPClaims{}, auth.ErrInvalidCredentials
	}
	if c.ExpiresAt.Sub(c.IssuedAt.Time) > maxLifetime {
		return auth.MCPClaims{}, auth.ErrInvalidCredentials
	}
	if c.Scope != auth.ScopeRead && c.Scope != auth.ScopeWrite {
		return auth.MCPClaims{}, auth.ErrInvalidCredentials
	}
	return auth.MCPClaims{UserID: c.Subject, Scope: c.Scope}, nil
}
