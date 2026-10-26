package user

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

// SessionRevoker invalidates every refresh token of a user, in all organizations.
type SessionRevoker interface {
	RevokeForUser(ctx context.Context, userID int64) error
}

type PasswordResetService struct {
	repo    Repository
	hasher  PasswordHasher
	otp     *OTP
	mailer  Mailer
	revoker SessionRevoker
	now     func() time.Time
}

func NewPasswordResetService(repo Repository, hasher PasswordHasher, otp *OTP, mailer Mailer, revoker SessionRevoker) *PasswordResetService {
	return &PasswordResetService{repo: repo, hasher: hasher, otp: otp, mailer: mailer, revoker: revoker, now: func() time.Time { return time.Now().UTC() }}
}

// ForgotPassword emails a one-time code if the email belongs to a user with a password.
// It returns nil in every such case, registered or not, rate limited or not, so the answer
// never reveals which emails exist. Only infrastructure failures are returned.
func (s *PasswordResetService) ForgotPassword(ctx context.Context, email string) error {
	email, err := normalizeEmail(email)
	if err != nil {
		return nil
	}
	u, err := s.repo.FindByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := s.repo.FindAccount(ctx, u.ID, ProviderDefault); errors.Is(err, ErrNotFound) {
		return nil // e.g. a Google-only user has no password to reset
	} else if err != nil {
		return err
	}
	code, err := s.otp.issue(ctx, PurposeReset, email, "")
	if errors.Is(err, ErrCodeTooSoon) {
		return nil
	}
	if err != nil {
		return err
	}
	// Best effort: a failed email just means the user asks for a new code later.
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplatePasswordReset, To: u.Email, Data: codeData(u.FirstName, code)})
	return nil
}

// ResetPassword checks the code and sets the new password. Every refresh token of the user
// is revoked first, so a stolen session cannot outlive the reset even if a later step fails.
func (s *PasswordResetService) ResetPassword(ctx context.Context, email, code, newPassword string) error {
	// Validate the password before spending one of the code's attempts.
	if n := utf8.RuneCountInString(newPassword); n < minPasswordLen || n > maxPasswordLen {
		return ErrWeakPassword
	}
	email, err := normalizeEmail(email)
	if err != nil {
		return ErrInvalidCode
	}
	if _, err := s.otp.check(ctx, PurposeReset, email, code); err != nil {
		return err
	}
	u, err := s.repo.FindByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return ErrInvalidCode
	}
	if err != nil {
		return err
	}
	hash, err := s.hasher.Hash(newPassword)
	if err != nil {
		return err
	}
	if err := s.revoker.RevokeForUser(ctx, u.ID); err != nil {
		return fmt.Errorf("user: revoke sessions: %w", err)
	}
	return s.repo.UpdatePassword(ctx, u.ID, hash, s.now())
}

// codeData is what the PASSWORD_RESET and VERIFY_EMAIL templates need.
func codeData(firstName, code string) map[string]string {
	return map[string]string{
		"FirstName":        firstName,
		"Code":             code,
		"ExpiresInMinutes": strconv.Itoa(int(codeTTL.Minutes())),
		"MaxAttempts":      strconv.Itoa(codeMaxAttempts),
	}
}
