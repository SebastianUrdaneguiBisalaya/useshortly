package analytics

import "errors"

var (
	// ErrNotFound is a link that does not exist or belongs to another tenant.
	ErrNotFound     = errors.New("analytics: link not found")
	ErrInvalidRange = errors.New("analytics: invalid date range")
)
