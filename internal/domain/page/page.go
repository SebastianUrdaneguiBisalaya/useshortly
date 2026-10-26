// Package page is the limit/offset window every list endpoint shares.
package page

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// Params selects a window of a list: up to Limit items after skipping Offset.
type Params struct {
	Limit  int
	Offset int
}

// Normalize makes a usable window: a missing or non-positive limit becomes DefaultLimit, a limit
// above MaxLimit is capped, and a negative offset becomes 0.
func (p Params) Normalize() Params {
	if p.Limit <= 0 {
		p.Limit = DefaultLimit
	}
	if p.Limit > MaxLimit {
		p.Limit = MaxLimit
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	return p
}
