package domain

import "errors"

var (
	ErrNotFound    = errors.New("domain: not found")
	ErrHostTaken   = errors.New("domain: host already registered")
	ErrInvalidHost = errors.New("domain: invalid host")
)

var (
	// ErrNotVerified means the domain exists but its owner has not proved control of the host yet.
	ErrNotVerified = errors.New("domain: not verified")
	// ErrVerificationFailed means the DNS TXT record is missing or does not have the expected value.
	ErrVerificationFailed = errors.New("domain: dns record not found")
)

// ErrLookupFailed means the DNS lookup itself failed (timeout, resolver down), so nothing is known
// about the record. The caller can try again.
var ErrLookupFailed = errors.New("domain: dns lookup failed")
