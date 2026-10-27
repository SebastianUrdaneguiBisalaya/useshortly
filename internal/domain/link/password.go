package link

import (
	"context"
	"errors"
	"time"
)

const (
	minPasswordLen = 4
	maxPasswordLen = 64
)

// unlockBackoff is how unlock tries are slowed down: a visitor gets 3 free tries, and from the
// third on every try is followed by a wait that doubles (30 s, 1 min, 2 min... up to 1 hour). A
// right password clears it; a visitor who stops trying is forgiven after a day.
var unlockBackoff = Backoff{Free: 3, Base: 30 * time.Second, Max: time.Hour, Memory: 24 * time.Hour}

// Backoff is a policy that makes repeated tries wait longer each time.
type Backoff struct {
	// Free is how many tries pass before waits start: the Free-th try is the first to be followed by one.
	Free int
	// Base is the first wait; each next one doubles, up to Max.
	Base, Max time.Duration
	// Memory is how long the count is kept after the last try.
	Memory time.Duration
}

// DelayAfter is the wait that follows the n-th try (1-based): zero before the Free-th try.
func (b Backoff) DelayAfter(n int) time.Duration {
	if n < b.Free {
		return 0
	}
	d := b.Base
	for i := 0; i < n-b.Free && d < b.Max; i++ {
		d *= 2
	}
	return min(d, b.Max)
}

// TooManyAttemptsError is ErrTooManyAttempts that also says how long to wait.
type TooManyAttemptsError struct {
	RetryAfter time.Duration
}

func (e *TooManyAttemptsError) Error() string        { return ErrTooManyAttempts.Error() }
func (e *TooManyAttemptsError) Is(target error) bool { return target == ErrTooManyAttempts }

// RetryAfter reports how long a visitor must wait if err is ErrTooManyAttempts.
func RetryAfter(err error) (time.Duration, bool) {
	var e *TooManyAttemptsError
	if errors.As(err, &e) {
		return e.RetryAfter, true
	}
	return 0, false
}

// PasswordHasher hides the hashing algorithm from the domain. Hash output must embed salt and
// parameters so Verify needs nothing else.
type PasswordHasher interface {
	Hash(password string) (string, error)
	// Verify reports whether password matches hash. A malformed hash is an error.
	Verify(hash, password string) (bool, error)
}

// AttemptLimiter slows down repeated tries of something, shared by every instance.
type AttemptLimiter interface {
	// Take counts one try for key under the policy. retryAfter > 0 with allowed=false means the
	// key is waiting and this try must be refused without being counted; allowed=true means go
	// ahead, and retryAfter is the wait that follows this try (zero while tries are free). The
	// count and the check are one atomic step, so parallel guesses cannot get past a wait.
	Take(ctx context.Context, key string, policy Backoff) (allowed bool, retryAfter time.Duration, err error)
	// Reset forgets the tries of key.
	Reset(ctx context.Context, key string) error
}

func validPassword(p string) bool {
	return len(p) >= minPasswordLen && len(p) <= maxPasswordLen
}
