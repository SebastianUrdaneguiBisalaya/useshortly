package analytics

import (
	"net/netip"
	"time"
)

// Click is one redirect of a link. Country and Device are filled by the enrichment step, so
// they are empty until then.
type Click struct {
	ID        int64
	LinkID    int64
	At        time.Time
	Referrer  string
	UserAgent string
	Country   string
	Device    string
	// IP is the visitor's address. It only travels to the enrichment step to find the country
	// and is never stored.
	IP netip.Addr
}
