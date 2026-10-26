package apikey

import "errors"

var (
	ErrNotFound      = errors.New("apikey: not found")
	ErrExpired       = errors.New("apikey: expired")
	ErrInvalidName   = errors.New("apikey: invalid name")
	ErrInvalidExpiry = errors.New("apikey: expiration must be in the future")
)
