package geoip

import (
	"errors"
	"net/netip"
	"os"
	"testing"

	"github.com/oschwald/geoip2-golang/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeReader struct {
	byIP  map[netip.Addr]string
	err   error
	asked []netip.Addr
}

func (f *fakeReader) Country(ip netip.Addr) (*geoip2.Country, error) {
	f.asked = append(f.asked, ip)
	if f.err != nil {
		return nil, f.err
	}
	var c geoip2.Country
	c.Country.ISOCode = f.byIP[ip]
	return &c, nil
}

func (f *fakeReader) Close() error { return nil }

func TestCountry(t *testing.T) {
	fake := &fakeReader{byIP: map[netip.Addr]string{
		netip.MustParseAddr("81.2.69.142"): "GB",
		netip.MustParseAddr("2a02::1"):     "ES",
	}}
	r := &Resolver{reader: fake}

	assert.Equal(t, "GB", r.Country(netip.MustParseAddr("81.2.69.142")))
	assert.Equal(t, "ES", r.Country(netip.MustParseAddr("2a02::1")))
	assert.Equal(t, "GB", r.Country(netip.MustParseAddr("::ffff:81.2.69.142")), "an IPv4 address in IPv6 form is looked up as IPv4")
	assert.Empty(t, r.Country(netip.MustParseAddr("10.0.0.1")), "unknown address")
	assert.Empty(t, r.Country(netip.Addr{}), "no address")
	assert.Len(t, fake.asked, 4, "the invalid address is not even looked up")
}

func TestCountryLookupErrorIsEmpty(t *testing.T) {
	r := &Resolver{reader: &fakeReader{err: errors.New("corrupt")}}
	assert.Empty(t, r.Country(netip.MustParseAddr("81.2.69.142")))
}

func TestOpenFailsOnAMissingFile(t *testing.T) {
	_, err := Open("/does/not/exist.mmdb")
	assert.Error(t, err)
}

// Needs a real database: GEOIP_DB_PATH=/path/dbip-city-lite.mmdb go test ./internal/adapter/geoip/
func TestOpenRealDatabase(t *testing.T) {
	path := os.Getenv("GEOIP_DB_PATH")
	if path == "" {
		t.Skip("GEOIP_DB_PATH not set")
	}
	r, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { r.Close() })
	assert.Equal(t, "US", r.Country(netip.MustParseAddr("8.8.8.8")))
	assert.Empty(t, r.Country(netip.MustParseAddr("127.0.0.1")))
}
