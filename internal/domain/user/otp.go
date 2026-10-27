package user

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"
)

const (
	codeTTL         = 10 * time.Minute
	codeCooldown    = 60 * time.Second
	codeMaxAttempts = 3
)

// Purpose keeps the codes of different flows apart: a password reset code can never
// complete a signup, nor the other way round.
type Purpose string

const (
	PurposeReset  Purpose = "reset"
	PurposeSignup Purpose = "signup"
	PurposeDelete Purpose = "delete"
)

// CodeStore keeps the hash of the pending one-time code of an email for a purpose, plus
// an opaque payload returned when the code is right. It must be shared by every instance
// and expire entries on its own (Redis).
type CodeStore interface {
	// Put stores codeHash and payload, replacing any previous code of that purpose and
	// resetting its attempts. Returns ErrCodeTooSoon if one was stored less than cooldown ago.
	Put(ctx context.Context, purpose Purpose, email, codeHash, payload string, ttl, cooldown time.Duration) error
	// Check atomically compares codeHash with the stored one and counts the attempt.
	// A match deletes the code (single use) and returns its payload. After maxAttempts
	// wrong tries the code is deleted and ErrTooManyAttempts is returned. A missing or
	// expired code and a wrong one are both ErrInvalidCode.
	Check(ctx context.Context, purpose Purpose, email, codeHash string, maxAttempts int) (payload string, err error)
}

// OTP issues and checks the emailed one-time codes (6 digits, 10 minutes, 3 attempts,
// single use, one per minute per email).
type OTP struct {
	store CodeStore
	// key signs the stored hashes: 6 digits are trivial to brute-force from a plain hash
	// if the store leaks, but not from an HMAC under a key the store never sees.
	key     []byte
	newCode func() (string, error)
}

func NewOTP(store CodeStore, key string) *OTP {
	return &OTP{store: store, key: []byte(key), newCode: randomCode}
}

// issue stores a fresh code for email and returns it so it can be mailed.
func (o *OTP) issue(ctx context.Context, purpose Purpose, email, payload string) (string, error) {
	code, err := o.newCode()
	if err != nil {
		return "", err
	}
	if err := o.store.Put(ctx, purpose, email, o.hash(purpose, email, code), payload, codeTTL, codeCooldown); err != nil {
		return "", err
	}
	return code, nil
}

func (o *OTP) check(ctx context.Context, purpose Purpose, email, code string) (string, error) {
	return o.store.Check(ctx, purpose, email, o.hash(purpose, email, code), codeMaxAttempts)
}

func (o *OTP) hash(purpose Purpose, email, code string) string {
	m := hmac.New(sha256.New, o.key)
	m.Write([]byte(string(purpose) + ":" + email + ":" + code))
	return hex.EncodeToString(m.Sum(nil))
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("user: one-time code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
