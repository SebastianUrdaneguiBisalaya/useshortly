package link

import (
	"context"
	"time"
)

const (
	minPasswordLen = 4
	maxPasswordLen = 64

	// A visitor gets unlockAttempts tries per link every unlockWindow, whether they are right or
	// wrong; a right one clears the count.
	unlockAttempts = 3
	unlockWindow   = 15 * time.Minute
)

// PasswordHasher hides the hashing algorithm from the domain. Hash output must embed salt and
// parameters so Verify needs nothing else.
type PasswordHasher interface {
	Hash(password string) (string, error)
	// Verify reports whether password matches hash. A malformed hash is an error.
	Verify(hash, password string) (bool, error)
}

// AttemptLimiter bounds how many times something may be tried, shared by every instance.
type AttemptLimiter interface {
	// Take counts one attempt for key and reports whether it is within limit attempts per
	// window. The first attempt starts the window. The count and the check are one atomic step, so
	// concurrent guesses cannot get past the limit.
	Take(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
	// Reset forgets the attempts of key.
	Reset(ctx context.Context, key string) error
}

func validPassword(p string) bool {
	return len(p) >= minPasswordLen && len(p) <= maxPasswordLen
}
