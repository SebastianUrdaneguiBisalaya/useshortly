// Package dns implements domain.DNSResolver with the system resolver.
package dns

import (
	"context"
	"errors"
	"net"
	"time"
)

// lookupTimeout bounds one lookup so a slow name server cannot hold a request open.
const lookupTimeout = 5 * time.Second

type Resolver struct {
	r *net.Resolver
}

func NewResolver() *Resolver { return &Resolver{r: net.DefaultResolver} }

// LookupTXT returns the TXT records of name, or none if the name has no records or does not exist.
func (r *Resolver) LookupTXT(ctx context.Context, name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	records, err := r.r.LookupTXT(ctx, name)
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
		return nil, nil
	}
	return records, err
}
