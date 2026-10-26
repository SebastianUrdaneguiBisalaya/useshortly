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
