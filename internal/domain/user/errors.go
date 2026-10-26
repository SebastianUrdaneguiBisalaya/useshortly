package user

import "errors"

var (
	ErrNotFound     = errors.New("user: not found")
	ErrEmailTaken   = errors.New("user: email already registered")
	ErrInvalidEmail = errors.New("user: invalid email")
	ErrInvalidName  = errors.New("user: invalid name")
	ErrWeakPassword = errors.New("user: password must be between 8 and 128 characters")

	// One-time codes (signup, password reset). An expired, missing or wrong code is always
	// ErrInvalidCode.
	ErrInvalidCode     = errors.New("user: invalid or expired code")
	ErrTooManyAttempts = errors.New("user: too many attempts, request a new code")
	ErrCodeTooSoon     = errors.New("user: a code was requested too recently")

	// Google sign-in.
	ErrGoogleEmailNotVerified = errors.New("user: google email is not verified")
	// ErrProviderMismatch: the email already belongs to a user with a different sign-in
	// method (password vs Google). Methods are never merged, see GoogleService.Login.
	ErrProviderMismatch = errors.New("user: email is registered with another sign-in method")
)
