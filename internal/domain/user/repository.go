package user

import "context"

type Repository interface {
	// Create stores the user and its first account atomically.
	// Returns ErrEmailTaken if the email is already registered (case-insensitive).
	Create(ctx context.Context, u User, a Account) (User, error)
	// FindByEmail returns ErrNotFound if there is no such user.
	FindByEmail(ctx context.Context, email string) (User, error)
	FindByID(ctx context.Context, id int64) (User, error)
	// FindAccount returns ErrNotFound if the user has no account for the provider.
	FindAccount(ctx context.Context, userID int64, provider Provider) (Account, error)
	// FindAccountByProvider looks an account up by the provider's own id (e.g. Google's
	// "sub"). Returns ErrNotFound.
	FindAccountByProvider(ctx context.Context, provider Provider, accountID string) (Account, error)
	// UpdatePassword replaces the hash of the user's DEFAULT account. Returns ErrNotFound
	// if the user has no password account.
	UpdatePassword(ctx context.Context, userID int64, hash string) error
}
