package useragent

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

func TestDetect(t *testing.T) {
	tests := []struct {
		name string
		ua   string
		want string
	}{
		{"empty", "", ""},
		{"blank", "   ", ""},
		{"chrome on windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", analytics.DeviceDesktop},
		{"safari on mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", analytics.DeviceDesktop},
		{"firefox on linux", "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", analytics.DeviceDesktop},
		{"iphone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", analytics.DeviceMobile},
		{"android phone", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", analytics.DeviceMobile},
		{"ipad", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", analytics.DeviceTablet},
		{"android tablet has no Mobile", "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", analytics.DeviceTablet},
		{"googlebot", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", analytics.DeviceBot},
		{"curl", "curl/8.4.0", analytics.DeviceBot},
		{"slack link preview", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", analytics.DeviceBot},
		{"facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", analytics.DeviceBot},
		{"python script", "python-requests/2.31.0", analytics.DeviceBot},
		{"unknown but not empty", "SomethingNew/1.0", analytics.DeviceDesktop},
	}
	d := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, d.Detect(tt.ua))
		})
	}
}
