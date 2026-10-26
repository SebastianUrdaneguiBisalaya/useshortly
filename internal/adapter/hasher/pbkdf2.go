// Package hasher implements user.PasswordHasher.
package hasher

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	// OWASP recommendation for PBKDF2-HMAC-SHA256.
	defaultIterations = 600_000
	saltLen           = 16
	keyLen            = 32
	scheme            = "pbkdf2-sha256"
)

var ErrMalformedHash = errors.New("hasher: malformed hash")

// PBKDF2 hashes with the standard library only (no extra dependency). Swapping to
// argon2id or bcrypt means writing another adapter for user.PasswordHasher.
// Hash format: $pbkdf2-sha256$<iterations>$<salt b64>$<key b64>
type PBKDF2 struct {
	iterations int
}

func NewPBKDF2() *PBKDF2 {
	return &PBKDF2{iterations: defaultIterations}
}

func (h *PBKDF2) Hash(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("hasher: salt: %w", err)
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, h.iterations, keyLen)
	if err != nil {
		return "", fmt.Errorf("hasher: derive key: %w", err)
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$%s$%d$%s$%s", scheme, h.iterations, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func (h *PBKDF2) Verify(hash, password string) (bool, error) {
	parts := strings.Split(hash, "$")
	if len(parts) != 5 || parts[0] != "" || parts[1] != scheme {
		return false, ErrMalformedHash
	}
	iterations, err := strconv.Atoi(parts[2])
	if err != nil || iterations <= 0 {
		return false, ErrMalformedHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, ErrMalformedHash
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(want) == 0 {
		return false, ErrMalformedHash
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(want))
	if err != nil {
		return false, fmt.Errorf("hasher: derive key: %w", err)
	}
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
