package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// Mailer sends a template by code. Failures must not matter to the caller, so every use
// ignores the result: wire an asynchronous, best-effort implementation (mailing.Async).
type Mailer interface {
	Send(ctx context.Context, code, to string, data map[string]string) error
}

type Service struct {
	repo   Repository
	hasher PasswordHasher
	tokens auth.TokenService
	mailer Mailer
	otp    *OTP
	now    func() time.Time
	// dummyHash is verified when the email is unknown so Login takes the same time
	// either way and does not reveal which emails are registered.
	dummyHash string
}

func NewService(repo Repository, hasher PasswordHasher, tokens auth.TokenService, mailer Mailer, otp *OTP) *Service {
	dummy, _ := hasher.Hash("useshortly-dummy-password")
	return &Service{
		repo:      repo,
		hasher:    hasher,
		tokens:    tokens,
		mailer:    mailer,
		otp:       otp,
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

// pendingSignup is what waits in the code store until the email is confirmed. Nothing
// reaches the database before that, so nobody can hold an address they do not own.
type pendingSignup struct {
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	PasswordHash string `json:"password_hash"`
}

// Register starts a signup: it validates the input and emails a one-time code to the
// address. The user is only created by VerifyRegistration, with the code from the email.
// Registering again before that replaces the pending signup.
func (s *Service) Register(ctx context.Context, in RegisterInput) error {
	email, err := normalizeEmail(in.Email)
	if err != nil {
		return err
	}
	first, last := strings.TrimSpace(in.FirstName), strings.TrimSpace(in.LastName)
	if !validName(first) || !validName(last) {
		return ErrInvalidName
	}
	if n := utf8.RuneCountInString(in.Password); n < minPasswordLen || n > maxPasswordLen {
		return ErrWeakPassword
	}
	if _, err := s.repo.FindByEmail(ctx, email); err == nil {
		return ErrEmailTaken
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(pendingSignup{FirstName: first, LastName: last, PasswordHash: hash})
	if err != nil {
		return err
	}
	code, err := s.otp.issue(ctx, PurposeSignup, email, string(payload))
	if err != nil {
		return err
	}
	// Best effort like every email: if it is lost the user registers again after the
	// cooldown and gets a new code.
	_ = s.mailer.Send(ctx, mailing.TemplateVerifyEmail, email, codeData(first, code))
	return nil
}

// VerifyRegistration checks the emailed code and creates the user with a verified email,
// then signs them in.
func (s *Service) VerifyRegistration(ctx context.Context, email, code string) (Session, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return Session{}, ErrInvalidCode
	}
	raw, err := s.otp.check(ctx, PurposeSignup, email, code)
	if err != nil {
		return Session{}, err
	}
	var p pendingSignup
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return Session{}, fmt.Errorf("user: pending signup: %w", err)
	}
	now := s.now()
	// ErrEmailTaken here means the address was claimed meanwhile (e.g. a Google sign-in).
	u, err := s.repo.Create(ctx,
		User{Email: email, EmailVerified: true, FirstName: p.FirstName, LastName: p.LastName, CreatedAt: now},
		Account{AccountID: email, Provider: ProviderDefault, PasswordHash: p.PasswordHash, CreatedAt: now},
	)
	if err != nil {
		return Session{}, err
	}
	tok, err := s.tokens.Generate(ctx, itoa(u.ID))
	if err != nil {
		return Session{}, err
	}
	// Best effort: a welcome email must never fail or delay the signup.
	_ = s.mailer.Send(ctx, mailing.TemplateWelcome, u.Email, map[string]string{
		"FirstName": u.FirstName,
		"LastName":  u.LastName,
	})
	return Session{User: u, Token: tok}, nil
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
