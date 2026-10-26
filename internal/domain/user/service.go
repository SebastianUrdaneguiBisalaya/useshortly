package user

import (
	"context"
	"errors"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

const (
	minPasswordLen = 8
	maxPasswordLen = 128
	maxFieldLen    = 255
)

// Mailer sends a template by code. Failures must not matter to the caller: Register and
// Login ignore the result, so wire an asynchronous, best-effort implementation (mailing.Async).
type Mailer interface {
	Send(ctx context.Context, code, to string, data map[string]string) error
}

type Service struct {
	repo   Repository
	hasher PasswordHasher
	tokens auth.TokenService
	mailer Mailer
	now    func() time.Time
	// dummyHash is verified when the email is unknown so Login takes the same time
	// either way and does not reveal which emails are registered.
	dummyHash string
}

func NewService(repo Repository, hasher PasswordHasher, tokens auth.TokenService, mailer Mailer) *Service {
	dummy, _ := hasher.Hash("useshortly-dummy-password")
	return &Service{
		repo:      repo,
		hasher:    hasher,
		tokens:    tokens,
		mailer:    mailer,
		now:       time.Now().UTC,
		dummyHash: dummy,
	}
}

type RegisterInput struct {
	Email     string
	Password  string
	FirstName string
	LastName  string
}

// Session is what a successful Login returns.
type Session struct {
	User  User
	Token auth.Token
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (User, error) {
	email, err := normalizeEmail(in.Email)
	if err != nil {
		return User{}, err
	}
	first, last := strings.TrimSpace(in.FirstName), strings.TrimSpace(in.LastName)
	if !validName(first) || !validName(last) {
		return User{}, ErrInvalidName
	}
	if n := utf8.RuneCountInString(in.Password); n < minPasswordLen || n > maxPasswordLen {
		return User{}, ErrWeakPassword
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return User{}, err
	}
	now := s.now()
	u, err := s.repo.Create(ctx,
		User{Email: email, FirstName: first, LastName: last, CreatedAt: now},
		Account{AccountID: email, Provider: ProviderDefault, PasswordHash: hash, CreatedAt: now},
	)
	if err != nil {
		return User{}, err
	}
	// Best effort: a welcome email must never fail or delay the signup.
	_ = s.mailer.Send(ctx, mailing.TemplateWelcome, u.Email, map[string]string{
		"FirstName": u.FirstName,
		"LastName":  u.LastName,
	})
	return u, nil
}

// Login checks the credentials and issues a token. Every failure caused by bad
// credentials returns auth.ErrInvalidCredentials, whether the email exists or not.
func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return Session{}, auth.ErrInvalidCredentials
	}
	u, err := s.repo.FindByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		_, _ = s.hasher.Verify(s.dummyHash, password)
		return Session{}, auth.ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	acc, err := s.repo.FindAccount(ctx, u.ID, ProviderDefault)
	if errors.Is(err, ErrNotFound) { // e.g. a Google-only user
		_, _ = s.hasher.Verify(s.dummyHash, password)
		return Session{}, auth.ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	ok, err := s.hasher.Verify(acc.PasswordHash, password)
	if err != nil {
		return Session{}, err
	}
	if !ok {
		return Session{}, auth.ErrInvalidCredentials
	}
	tok, err := s.tokens.Generate(ctx, itoa(u.ID))
	if err != nil {
		return Session{}, err
	}
	// Best effort: a sign-in alert must never fail or delay the login itself.
	_ = s.mailer.Send(ctx, mailing.TemplateLogin, u.Email, map[string]string{
		"FirstName": u.FirstName,
		"Time":      s.now().Format(time.RFC1123),
	})
	return Session{User: u, Token: tok}, nil
}

// Authenticate resolves a token to its user.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	sub, err := s.tokens.Validate(ctx, token)
	if err != nil {
		return User{}, err
	}
	id, err := strconv.ParseInt(sub, 10, 64)
	if err != nil {
		return User{}, auth.ErrInvalidCredentials
	}
	u, err := s.repo.FindByID(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return User{}, auth.ErrInvalidCredentials
	}
	return u, err
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > maxFieldLen {
		return "", ErrInvalidEmail
	}
	return email, nil
}

func validName(n string) bool {
	return n != "" && utf8.RuneCountInString(n) <= maxFieldLen
}

func itoa(id int64) string { return strconv.FormatInt(id, 10) }
