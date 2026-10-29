package analytics

import "errors"

var (
	// ErrNotFound is a link that does not exist or belongs to another tenant.
	ErrNotFound     = errors.New("analytics: link not found")
	ErrInvalidRange = errors.New("analytics: invalid date range")
	// ErrInvalidTimeZone is a time zone name that is not an IANA zone.
	ErrInvalidTimeZone = errors.New("analytics: invalid time zone")
	// ErrCampaignNotFound is a campaign that does not exist or belongs to another tenant.
	ErrCampaignNotFound = errors.New("analytics: campaign not found")
	// ErrCampaignsDisabled: the service was built without campaign statistics.
	ErrCampaignsDisabled = errors.New("analytics: campaigns are not enabled")
)
