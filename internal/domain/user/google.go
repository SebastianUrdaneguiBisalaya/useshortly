package user

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

// GoogleIdentity is what a verified Google ID token says about its owner.
type GoogleIdentity struct {
	Subject       string // Google's stable user id
	Email         string
	EmailVerified bool
	FirstName     string
	LastName      string
	PictureURL    string
}

// GoogleVerifier validates an ID token (signature, audience, expiry) with Google.
// Returns auth.ErrInvalidCredentials for a token that is not valid.
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (GoogleIdentity, error)
}

type GoogleService struct {
	repo     Repository
	verifier GoogleVerifier
	tokens   auth.TokenService
	mailer   Mailer
	now      func() time.Time
}

func NewGoogleService(repo Repository, verifier GoogleVerifier, tokens auth.TokenService, mailer Mailer) *GoogleService {
	return &GoogleService{repo: repo, verifier: verifier, tokens: tokens, mailer: mailer, now: time.Now().UTC}
}

// Login signs in with a Google ID token, creating the user on first use. An email
// belongs to exactly one sign-in method: if it is already registered with a password
// (or with another Google account) the login is refused with ErrProviderMismatch instead
// of merging the two, which is what stops someone from taking over an address by
// registering it first. An unverified Google email is refused too.
func (s *GoogleService) Login(ctx context.Context, idToken string) (Session, error) {
	id, err := s.verifier.Verify(ctx, idToken)
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
	tok, err := s.tokens.Generate(ctx, itoa(u.ID))
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
	return Session{User: u, Token: tok}, nil
}

func (s *GoogleService) findOrCreate(ctx context.Context, id GoogleIdentity, email string) (u User, created bool, err error) {
	acc, err := s.repo.FindAccountByProvider(ctx, ProviderGoogle, id.Subject)
	if err == nil {
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
		Account{AccountID: id.Subject, Provider: ProviderGoogle, CreatedAt: now},
	)
	if errors.Is(err, ErrEmailTaken) { // a concurrent sign-in or signup took the email first
		return User{}, false, ErrProviderMismatch
	}
	return u, err == nil, err
}
