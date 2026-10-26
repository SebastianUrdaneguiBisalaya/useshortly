// Package hasher implements user.PasswordHasher.
package hasher

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Parameters follow RFC 9106 (second recommended option for memory-constrained setups).
const (
	defaultMemory  uint32 = 64 * 1024 // KiB
	defaultTime    uint32 = 3
	defaultThreads uint8  = 2
	saltLen               = 16
	keyLen         uint32 = 32
)

var ErrMalformedHash = errors.New("hasher: malformed hash")

// Argon2id hashes passwords as PHC strings:
// $argon2id$v=19$m=<KiB>,t=<passes>,p=<threads>$<salt b64>$<key b64>
// The parameters live in the hash, so they can be raised later without breaking old hashes.
type Argon2id struct {
	memory  uint32
	time    uint32
	threads uint8
}

func NewArgon2id() *Argon2id {
	return &Argon2id{memory: defaultMemory, time: defaultTime, threads: defaultThreads}
}

func (h *Argon2id) Hash(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("hasher: salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, h.time, h.memory, h.threads, keyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, h.memory, h.time, h.threads, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func (h *Argon2id) Verify(hash, password string) (bool, error) {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false, ErrMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrMalformedHash
	}
	var memory, passes uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &passes, &threads); err != nil ||
		memory == 0 || passes == 0 || threads == 0 {
		return false, ErrMalformedHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrMalformedHash
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, ErrMalformedHash
	}
	got := argon2.IDKey([]byte(password), salt, passes, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
