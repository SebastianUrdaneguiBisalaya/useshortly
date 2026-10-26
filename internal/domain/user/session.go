package user

import (
	"context"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
)

// RefreshTokens is the refresh-token service as the user package needs it
// (*auth.RefreshService satisfies it).
type RefreshTokens interface {
	Issue(ctx context.Context, userID int64) (auth.RefreshGrant, error)
	Rotate(ctx context.Context, secret string) (userID int64, grant auth.RefreshGrant, err error)
	Revoke(ctx context.Context, secret string) error
}

// Session is what a successful sign-in returns: the short-lived access token and the
// long-lived refresh token that renews it.
type Session struct {
	User    User
	Token   auth.Token
	Refresh auth.RefreshGrant
}

// sessions opens sessions; every way of signing in (password, signup, Google, refresh) uses it.
type sessions struct {
	tokens  auth.TokenService
	refresh RefreshTokens
}

// open issues a new access token for u plus a brand new refresh token.
func (s sessions) open(ctx context.Context, u User) (Session, error) {
	grant, err := s.refresh.Issue(ctx, u.ID)
	if err != nil {
		return Session{}, err
	}
	return s.withGrant(ctx, u, grant)
}

// withGrant issues an access token for u next to an existing refresh grant.
func (s sessions) withGrant(ctx context.Context, u User, grant auth.RefreshGrant) (Session, error) {
	tok, err := s.tokens.Generate(ctx, itoa(u.ID))
	if err != nil {
		return Session{}, err
	}
	return Session{User: u, Token: tok, Refresh: grant}, nil
}
