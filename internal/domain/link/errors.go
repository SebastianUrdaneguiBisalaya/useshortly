package link

import "errors"

var (
	ErrNotFound     = errors.New("link: not found")
	ErrExpired      = errors.New("link: expired")
	ErrInvalidURL   = errors.New("link: invalid URL")
	ErrCodeTaken    = errors.New("link: code taken")
	ErrInvalidAlias = errors.New("link: invalid alias")
	ErrAliasTaken   = errors.New("link: alias taken")
)
