package auth

import (
	"context"
	"time"
)

// Token is a signed credential and the instant it stops being valid.
type Token struct {
	Value     string
	ExpiresAt time.Time
}

type TokenService interface {
	Generate(ctx context.Context, userID string) (Token, error)
	// Validate returns ErrTokenExpired for an expired token and ErrInvalidCredentials
	// for any other invalid one.
	Validate(ctx context.Context, token string) (userID string, err error)
}

// MCP token scopes. They mirror the API key scopes: write implies read.
const (
	ScopeRead  = "read"
	ScopeWrite = "write"
)

// MCPClaims is what a verified MCP token says: which user it acts for and with which scope.
type MCPClaims struct {
	UserID string
	Scope  string
}

// MCPTokenVerifier checks the short-lived tokens the MCP server signs for each API call.
// The API only holds the public key, so it can verify them but never mint them.
type MCPTokenVerifier interface {
	// Verify returns ErrTokenExpired for an expired token and ErrInvalidCredentials for any
	// other invalid one (signature, issuer, audience, scope, lifetime).
	Verify(ctx context.Context, token string) (MCPClaims, error)
}
