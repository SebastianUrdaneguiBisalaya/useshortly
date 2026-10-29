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
	Send(ctx context.Context, req mailing.Request) error
}

type Service struct {
	repo     Repository
	hasher   PasswordHasher
	sessions sessions
	mailer   Mailer
	otp      *OTP
	now      func() time.Time
	// dummyHash is verified when the email is unknown so Login takes the same time
	// either way and does not reveal which emails are registered.
	dummyHash string
}

func NewService(repo Repository, hasher PasswordHasher, tokens auth.TokenService, refresh RefreshTokens, mailer Mailer, otp *OTP) *Service {
	dummy, _ := hasher.Hash("useshortly-dummy-password")
	return &Service{
		repo:      repo,
		hasher:    hasher,
		sessions:  sessions{tokens: tokens, refresh: refresh},
		mailer:    mailer,
		otp:       otp,
		now:       func() time.Time { return time.Now().UTC() },
		dummyHash: dummy,
	}
}

type RegisterInput struct {
	Email     string
	Password  string
	FirstName string
	LastName  string
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
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateVerifyEmail, To: email, Data: codeData(first, code)})
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
	session, err := s.sessions.open(ctx, u)
	if err != nil {
		return Session{}, err
	}
	// Best effort: a welcome email must never fail or delay the signup.
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateWelcome, To: u.Email, Data: map[string]string{
		"FirstName": u.FirstName,
		"LastName":  u.LastName,
	}})
	return session, nil
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
	session, err := s.sessions.open(ctx, u)
	if err != nil {
		return Session{}, err
	}
	// Best effort: a sign-in alert must never fail or delay the login itself.
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateLogin, To: u.Email, Data: map[string]string{
		"FirstName": u.FirstName,
		"Time":      s.now().Format(time.RFC1123),
	}})
	return session, nil
}

// Refresh exchanges a refresh token for a new access token and a new refresh token (each
// refresh token works once). Every bad token is auth.ErrInvalidCredentials.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Session, error) {
	userID, grant, err := s.sessions.refresh.Rotate(ctx, refreshToken)
	if err != nil {
		return Session{}, err
	}
	u, err := s.repo.FindByID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return Session{}, auth.ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	return s.sessions.withGrant(ctx, u, grant)
}

// Logout ends the session of one refresh token. Unknown tokens are not an error.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	return s.sessions.refresh.Revoke(ctx, refreshToken)
}

// Authenticate resolves a token to its user.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	sub, err := s.sessions.tokens.Validate(ctx, token)
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

// ByID returns the user with that id, or auth.ErrInvalidCredentials when there is none: a
// credential for a user that no longer exists must stop working.
func (s *Service) ByID(ctx context.Context, id int64) (User, error) {
	u, err := s.repo.FindByID(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return User{}, auth.ErrInvalidCredentials
	}
	return u, err
}

// Providers lists how the user can sign in (ProviderDefault, ProviderGoogle). Never nil.
func (s *Service) Providers(ctx context.Context, userID int64) ([]Provider, error) {
	ps, err := s.repo.ListProviders(ctx, userID)
	if err != nil {
		return nil, err
	}
	if ps == nil {
		ps = []Provider{}
	}
	return ps, nil
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
