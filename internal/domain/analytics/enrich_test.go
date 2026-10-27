package analytics

import (
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type fakeDevices struct{ seen []string }

func (f *fakeDevices) Detect(ua string) string {
	f.seen = append(f.seen, ua)
	return DeviceMobile
}

type fakeCountries struct{ seen []netip.Addr }

func (f *fakeCountries) Country(ip netip.Addr) string {
	f.seen = append(f.seen, ip)
	return "PE"
}

func TestEnrichment(t *testing.T) {
	ip := netip.MustParseAddr("200.1.2.3")

	t.Run("fills device and country", func(t *testing.T) {
		got := NewEnrichment(&fakeDevices{}, &fakeCountries{}).Enrich(Click{UserAgent: "ua", IP: ip})
		assert.Equal(t, DeviceMobile, got.Device)
		assert.Equal(t, "PE", got.Country)
	})

	t.Run("each source is optional", func(t *testing.T) {
		got := NewEnrichment(nil, &fakeCountries{}).Enrich(Click{UserAgent: "ua", IP: ip})
		assert.Empty(t, got.Device)
		assert.Equal(t, "PE", got.Country)

		got = NewEnrichment(&fakeDevices{}, nil).Enrich(Click{UserAgent: "ua", IP: ip})
		assert.Equal(t, DeviceMobile, got.Device)
		assert.Empty(t, got.Country)
	})

	t.Run("does not look up a missing address", func(t *testing.T) {
		countries := &fakeCountries{}
		got := NewEnrichment(nil, countries).Enrich(Click{})
		assert.Empty(t, got.Country)
		assert.Empty(t, countries.seen)
	})

	t.Run("keeps values already set", func(t *testing.T) {
		got := NewEnrichment(&fakeDevices{}, &fakeCountries{}).Enrich(Click{Device: DeviceBot, Country: "ES", IP: ip})
		assert.Equal(t, DeviceBot, got.Device)
		assert.Equal(t, "ES", got.Country)
	})
}

func TestRecorderEnrichesInTheWorkerAndNeverStoresTheIP(t *testing.T) {
	repo := &fakeRepo{}
	r := NewRecorder(repo, NewEnrichment(&fakeDevices{}, &fakeCountries{}), 8)
	r.now = func() time.Time { return fixedNow }
	r.Record(Click{LinkID: 1, UserAgent: "ua", IP: netip.MustParseAddr("200.1.2.3")})
	closeNow(t, r)
	got := repo.stored()
	if assert.Len(t, got, 1) {
		assert.Equal(t, DeviceMobile, got[0].Device)
		assert.Equal(t, "PE", got[0].Country)
		assert.False(t, got[0].IP.IsValid(), "the address is dropped before the click is stored")
	}
}
