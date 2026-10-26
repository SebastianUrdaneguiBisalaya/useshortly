package user

import "errors"

var (
	ErrNotFound     = errors.New("user: not found")
	ErrEmailTaken   = errors.New("user: email already registered")
	ErrInvalidEmail = errors.New("user: invalid email")
	ErrInvalidName  = errors.New("user: invalid name")
	ErrWeakPassword = errors.New("user: password must be between 8 and 128 characters")
)
