package domain

import "errors"

var (
	ErrNotFound    = errors.New("domain: not found")
	ErrHostTaken   = errors.New("domain: host already registered")
	ErrInvalidHost = errors.New("domain: invalid host")
)
