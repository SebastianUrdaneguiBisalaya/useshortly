// Package useragent classifies User-Agent headers by plain substring rules: no dependency and
// no database to keep up to date. It tells the broad kind of device, not the exact model.
package useragent

import (
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

// Detector implements analytics.DeviceDetector.
type Detector struct{}

func New() *Detector { return &Detector{} }

var (
	botMarkers = []string{
		"bot", "crawler", "spider", "slurp", "facebookexternalhit", "headlesschrome",
		"curl/", "wget/", "python-requests", "go-http-client", "okhttp", "java/", "libwww", "httpclient",
		"preview", "monitor", "uptime",
	}
	tabletMarkers = []string{"ipad", "tablet", "kindle", "silk/", "playbook"}
	mobileMarkers = []string{"mobi", "iphone", "ipod", "android", "windows phone", "blackberry", "opera mini"}
)

// Detect returns the device kind, or "" for an empty header. Order matters: bots first (many
// declare a mobile browser too), then tablets (Android tablets lack "Mobile"), then phones.
func (Detector) Detect(userAgent string) string {
	ua := strings.ToLower(strings.TrimSpace(userAgent))
	if ua == "" {
		return ""
	}
	switch {
	case containsAny(ua, botMarkers):
		return analytics.DeviceBot
	case containsAny(ua, tabletMarkers):
		return analytics.DeviceTablet
	case strings.Contains(ua, "android") && !strings.Contains(ua, "mobile"):
		return analytics.DeviceTablet
	case containsAny(ua, mobileMarkers):
		return analytics.DeviceMobile
	default:
		return analytics.DeviceDesktop
	}
}

func containsAny(s string, markers []string) bool {
	for _, m := range markers {
		if strings.Contains(s, m) {
			return true
		}
	}
	return false
}
