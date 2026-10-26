package user

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

const (
	resetCodeTTL      = 10 * time.Minute
	resetCodeCooldown = 60 * time.Second
	resetMaxAttempts  = 3
)

// ResetCodeStore keeps the hash of the pending reset code of an email. It must be shared
// by every instance and expire entries on its own (Redis).
type ResetCodeStore interface {
	// Put stores codeHash, replacing any previous code and resetting its attempts.
	// Returns ErrResetTooSoon if a code was stored less than cooldown ago.
	Put(ctx context.Context, email, codeHash string, ttl, cooldown time.Duration) error
	// Check atomically compares codeHash with the stored one and counts the attempt.
	// A match deletes the code (single use). After maxAttempts wrong tries the code is
	// deleted and ErrTooManyAttempts is returned. A missing or expired code and a wrong
	// one are both ErrInvalidResetCode.
	Check(ctx context.Context, email, codeHash string, maxAttempts int) error
}

// SessionRevoker invalidates every refresh token of a user, in all organizations.
type SessionRevoker interface {
	RevokeForUser(ctx context.Context, userID int64) error
}

type PasswordResetService struct {
	repo    Repository
	hasher  PasswordHasher
	store   ResetCodeStore
	mailer  Mailer
	revoker SessionRevoker
	// key signs the stored code hashes: 6 digits are trivial to brute-force from a plain
	// hash if the store leaks, but not from an HMAC under a key the store never sees.
	key     []byte
	newCode func() (string, error)
}

func NewPasswordResetService(repo Repository, hasher PasswordHasher, store ResetCodeStore, mailer Mailer, revoker SessionRevoker, key string) *PasswordResetService {
	return &PasswordResetService{
		repo: repo, hasher: hasher, store: store, mailer: mailer, revoker: revoker,
		key: []byte(key), newCode: randomCode,
	}
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
	code, err := s.newCode()
	if err != nil {
		return err
	}
	if err := s.store.Put(ctx, email, s.hash(email, code), resetCodeTTL, resetCodeCooldown); errors.Is(err, ErrResetTooSoon) {
		return nil
	} else if err != nil {
		return err
	}
	// Best effort: a failed email just means the user asks for a new code later.
	_ = s.mailer.Send(ctx, mailing.TemplatePasswordReset, u.Email, map[string]string{
		"FirstName":        u.FirstName,
		"Code":             code,
		"ExpiresInMinutes": strconv.Itoa(int(resetCodeTTL.Minutes())),
		"MaxAttempts":      strconv.Itoa(resetMaxAttempts),
	})
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
		return ErrInvalidResetCode
	}
	if err := s.store.Check(ctx, email, s.hash(email, code), resetMaxAttempts); err != nil {
		return err
	}
	u, err := s.repo.FindByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return ErrInvalidResetCode
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
	return s.repo.UpdatePassword(ctx, u.ID, hash)
}

func (s *PasswordResetService) hash(email, code string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(email + ":" + code))
	return hex.EncodeToString(m.Sum(nil))
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("user: reset code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
