package user

import "time"

// Provider identifies how an Account authenticates its user.
type Provider string

const (
	ProviderDefault Provider = "DEFAULT" // email + password
	ProviderGoogle  Provider = "GOOGLE"
)

type User struct {
	ID            int64
	Email         string
	EmailVerified bool
	FirstName     string
	LastName      string
	ImageURL      string
	CreatedAt     time.Time
	UpdatedAt     *time.Time
}

// Account is one way a User can sign in. PasswordHash is only set for ProviderDefault.
type Account struct {
	ID           int64
	UserID       int64
	AccountID    string
	Provider     Provider
	PasswordHash string
	// Scope is what the user granted Google (space separated); only for ProviderGoogle.
	Scope     string
	CreatedAt time.Time
	UpdatedAt *time.Time
}
