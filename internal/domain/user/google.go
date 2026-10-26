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

// Login signs in with a Google ID token, creating the user on first use:
//   - known Google account: sign in;
//   - unknown Google account, but the (verified) email already has a user: link Google to it;
//   - otherwise: create the user and its Google account.
//
// An unverified Google email is refused, otherwise anyone could claim an address they
// do not own and take over the account registered with it.
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
		_ = s.mailer.Send(ctx, mailing.TemplateWelcome, u.Email, map[string]string{
			"FirstName": u.FirstName, "LastName": u.LastName,
		})
	} else {
		_ = s.mailer.Send(ctx, mailing.TemplateLogin, u.Email, map[string]string{
			"FirstName": u.FirstName, "Time": s.now().Format(time.RFC1123),
		})
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
	now := s.now()
	account := Account{AccountID: id.Subject, Provider: ProviderGoogle, CreatedAt: now}

	u, err = s.repo.FindByEmail(ctx, email)
	switch {
	case err == nil:
		account.UserID = u.ID
		return u, false, s.repo.CreateAccount(ctx, account)
	case !errors.Is(err, ErrNotFound):
		return User{}, false, err
	}
	first, last := id.FirstName, id.LastName
	if strings.TrimSpace(first) == "" {
		first, _, _ = strings.Cut(email, "@")
	}
	u, err = s.repo.Create(ctx,
		User{Email: email, EmailVerified: true, FirstName: first, LastName: last, ImageURL: id.PictureURL, CreatedAt: now},
		account,
	)
	if errors.Is(err, ErrEmailTaken) {
		// Lost a race with a concurrent first sign-in: link to the user that won.
		if u, err = s.repo.FindByEmail(ctx, email); err != nil {
			return User{}, false, err
		}
		account.UserID = u.ID
		return u, false, s.repo.CreateAccount(ctx, account)
	}
	return u, err == nil, err
}
