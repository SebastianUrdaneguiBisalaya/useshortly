// Package domain is the custom domains an organization serves its short links from.
package domain

import "time"

// Domain is a host (e.g. go.example.com) owned by an organization (tenant). Host is stored
// lowercase and is unique across all tenants. It only serves links once VerifiedAt is set.
type Domain struct {
	ID         int64
	TenantID   int64
	Host       string
	VerifiedAt *time.Time
	CreatedAt  time.Time
}

// Verified reports whether the owner proved control of the host.
func (d Domain) Verified() bool { return d.VerifiedAt != nil }
