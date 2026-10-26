package apikey

import "errors"

var (
	ErrNotFound      = errors.New("apikey: not found")
	ErrExpired       = errors.New("apikey: expired")
	ErrInvalidName   = errors.New("apikey: invalid name")
	ErrInvalidScope  = errors.New("apikey: scope must be read or write")
	ErrInvalidExpiry = errors.New("apikey: expiration must be in the future")
)
