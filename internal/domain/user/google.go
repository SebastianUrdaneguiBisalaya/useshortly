package user

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

// GoogleIdentity is what Google says about the user who signed in.
type GoogleIdentity struct {
	Subject       string // Google's stable user id
	Email         string
	EmailVerified bool
	FirstName     string
	LastName      string
	PictureURL    string
	// Scope is what the user granted the app (space separated), from the token response.
	Scope string
}

// GoogleGrant is the authorization code a client got from Google, with what the client used
// to get it. The web app's popup flow sends only the code; the desktop app signs in through
// the system browser and a loopback redirect, so it also sends that RedirectURI and the PKCE
// CodeVerifier.
type GoogleGrant struct {
	Code         string
	RedirectURI  string
	CodeVerifier string
}

// GoogleAuth exchanges the authorization code the client got from Google for the verified
// identity of the user. It needs the client secret, which never leaves the server.
// Returns auth.ErrInvalidCredentials for a grant that is not valid.
type GoogleAuth interface {
	Exchange(ctx context.Context, grant GoogleGrant) (GoogleIdentity, error)
}

type GoogleService struct {
	repo     Repository
	google   GoogleAuth
	sessions sessions
	mailer   Mailer
	now      func() time.Time
}

func NewGoogleService(repo Repository, google GoogleAuth, tokens auth.TokenService, refresh RefreshTokens, mailer Mailer) *GoogleService {
	return &GoogleService{
		repo: repo, google: google, sessions: sessions{tokens: tokens, refresh: refresh}, mailer: mailer,
		now: func() time.Time { return time.Now().UTC() },
	}
}

// Login signs in with a Google authorization grant, creating the user on first use. An email
// belongs to exactly one sign-in method: if it is already registered with a password
// (or with another Google account) the login is refused with ErrProviderMismatch instead
// of merging the two, which is what stops someone from taking over an address by
// registering it first. An unverified Google email is refused too.
//
// The scope Google reports is saved on the Google account and refreshed on every login,
// since the user can grant more or less access over time.
func (s *GoogleService) Login(ctx context.Context, grant GoogleGrant) (Session, error) {
	id, err := s.google.Exchange(ctx, grant)
	if err != nil {
		return Session{}, err
	}
	email, err := normalizeEmail(id.Email)
	if err != nil || id.Subject == "" {
		return Session{}, auth.ErrInvalidCredentials
	}
	if !id.EmailVerified {
		return Session{}, ErrGoogleEmailNotVerified
	}
	u, created, err := s.findOrCreate(ctx, id, email)
	if err != nil {
		return Session{}, err
	}
	session, err := s.sessions.open(ctx, u)
	if err != nil {
		return Session{}, err
	}
	// Best effort: emails must never fail or delay the sign-in.
	if created {
		_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateWelcome, To: u.Email, Data: map[string]string{
			"FirstName": u.FirstName, "LastName": u.LastName,
		}})
	} else {
		_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateLogin, To: u.Email, Data: map[string]string{
			"FirstName": u.FirstName, "Time": s.now().Format(time.RFC1123),
		}})
	}
	return session, nil
}

func (s *GoogleService) findOrCreate(ctx context.Context, id GoogleIdentity, email string) (u User, created bool, err error) {
	acc, err := s.repo.FindAccountByProvider(ctx, ProviderGoogle, id.Subject)
	if err == nil {
		if acc.Scope != id.Scope {
			if err := s.repo.UpdateAccountScope(ctx, acc.ID, id.Scope, s.now()); err != nil {
				return User{}, false, err
			}
		}
		u, err = s.repo.FindByID(ctx, acc.UserID)
		return u, false, err
	}
	if !errors.Is(err, ErrNotFound) {
		return User{}, false, err
	}
	if _, err := s.repo.FindByEmail(ctx, email); err == nil {
		return User{}, false, ErrProviderMismatch
	} else if !errors.Is(err, ErrNotFound) {
		return User{}, false, err
	}
	first := id.FirstName
	if strings.TrimSpace(first) == "" {
		first, _, _ = strings.Cut(email, "@")
	}
	now := s.now()
	u, err = s.repo.Create(ctx,
		User{Email: email, EmailVerified: true, FirstName: first, LastName: id.LastName, ImageURL: id.PictureURL, CreatedAt: now},
		Account{AccountID: id.Subject, Provider: ProviderGoogle, Scope: id.Scope, CreatedAt: now},
	)
	if errors.Is(err, ErrEmailTaken) { // a concurrent sign-in or signup took the email first
		return User{}, false, ErrProviderMismatch
	}
	return u, err == nil, err
}
