// Package geoip finds the country of an address in a MaxMind GeoLite2/GeoIP2 Country or City
// database (.mmdb) that the operator downloads and mounts; it is optional.
package geoip

import (
	"fmt"
	"net/netip"

	"github.com/oschwald/geoip2-golang/v2"
)

// countryReader is the part of *geoip2.Reader the resolver uses, so tests can stand in for it.
type countryReader interface {
	Country(ip netip.Addr) (*geoip2.Country, error)
	Close() error
}

// Resolver implements analytics.CountryResolver.
type Resolver struct {
	reader countryReader
}

// Open reads the database at path. The file is memory-mapped; call Close when done.
func Open(path string) (*Resolver, error) {
	r, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("geoip: open %s: %w", path, err)
	}
	return &Resolver{reader: r}, nil
}

// Country returns the ISO 3166-1 alpha-2 code, or "" if the address is unknown or not public.
func (r *Resolver) Country(ip netip.Addr) string {
	if !ip.IsValid() {
		return ""
	}
	rec, err := r.reader.Country(ip.Unmap())
	if err != nil || rec == nil {
		return ""
	}
	return rec.Country.ISOCode
}

func (r *Resolver) Close() error { return r.reader.Close() }
