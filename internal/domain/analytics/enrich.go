package analytics

import "net/netip"

// DeviceDetector classifies a User-Agent header.
type DeviceDetector interface {
	// Detect returns Mobile, Tablet, Desktop or Bot, or "" if the agent says nothing.
	Detect(userAgent string) string
}

// CountryResolver finds where an address is.
type CountryResolver interface {
	// Country returns the ISO 3166-1 alpha-2 code, or "" if unknown.
	Country(ip netip.Addr) string
}

const (
	DeviceMobile  = "mobile"
	DeviceTablet  = "tablet"
	DeviceDesktop = "desktop"
	DeviceBot     = "bot"
)

// Enricher completes a click with what can be derived from the request.
type Enricher interface {
	Enrich(c Click) Click
}

// Enrichment fills Device and Country. Either source is optional: with nil, that field stays empty.
type Enrichment struct {
	devices   DeviceDetector
	countries CountryResolver
}

func NewEnrichment(devices DeviceDetector, countries CountryResolver) *Enrichment {
	return &Enrichment{devices: devices, countries: countries}
}

func (e *Enrichment) Enrich(c Click) Click {
	if e.devices != nil && c.Device == "" {
		c.Device = e.devices.Detect(c.UserAgent)
	}
	if e.countries != nil && c.Country == "" && c.IP.IsValid() {
		c.Country = e.countries.Country(c.IP)
	}
	return c
}
