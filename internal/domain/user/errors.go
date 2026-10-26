package user

import "errors"

var (
	ErrNotFound     = errors.New("user: not found")
	ErrEmailTaken   = errors.New("user: email already registered")
	ErrInvalidEmail = errors.New("user: invalid email")
	ErrInvalidName  = errors.New("user: invalid name")
	ErrWeakPassword = errors.New("user: password must be between 8 and 128 characters")

	// Password reset. An expired, missing or wrong code is always ErrInvalidResetCode.
	ErrInvalidResetCode = errors.New("user: invalid or expired reset code")
	ErrTooManyAttempts  = errors.New("user: too many attempts, request a new code")
	ErrResetTooSoon     = errors.New("user: a reset code was requested too recently")

	// Google sign-in.
	ErrGoogleEmailNotVerified = errors.New("user: google email is not verified")
	// ErrProviderMismatch: the email already belongs to a user with a different sign-in
	// method (password vs Google). Methods are never merged, see GoogleService.Login.
	ErrProviderMismatch = errors.New("user: email is registered with another sign-in method")
)
