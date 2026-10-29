package link

import (
	"context"
	"math"
	"net/url"
	"strconv"
)

const maxLogoURLLen = 255 // links.qr_logo_url column limit

// minContrast is the WCAG ratio below which a scanner struggles to tell the modules from the
// background.
const minContrast = 3.0

// QRStyle is how a link's QR code is drawn. An empty field is the default: black, white, no logo.
type QRStyle struct {
	// Foreground and Background are #rrggbb colors; the modules must be darker than the background.
	Foreground string
	Background string
	// LogoURL is an https image shown in the middle of the code by clients; the server never fetches it.
	LogoURL string
}

// IsZero reports whether the style is the default one.
func (s QRStyle) IsZero() bool { return s == QRStyle{} }

// SetQRStyle replaces the style of the tenant's link; a zero style restores the default.
func (s *Service) SetQRStyle(ctx context.Context, tenantID, id int64, style QRStyle) (Link, error) {
	if err := style.validate(); err != nil {
		return Link{}, err
	}
	if err := s.repo.SetQRStyle(ctx, tenantID, id, style); err != nil {
		return Link{}, err
	}
	return s.repo.FindByID(ctx, tenantID, id)
}

func (s QRStyle) validate() error {
	fg, bg := [3]float64{0, 0, 0}, [3]float64{1, 1, 1}
	var ok bool
	if s.Foreground != "" {
		if fg, ok = parseHex(s.Foreground); !ok {
			return ErrInvalidQRColor
		}
	}
	if s.Background != "" {
		if bg, ok = parseHex(s.Background); !ok {
			return ErrInvalidQRColor
		}
	}
	if luminance(fg) >= luminance(bg) || contrast(fg, bg) < minContrast {
		return ErrLowQRContrast
	}
	if s.LogoURL != "" {
		u, err := url.ParseRequestURI(s.LogoURL)
		if len(s.LogoURL) > maxLogoURLLen || err != nil || u.Scheme != "https" || u.Host == "" {
			return ErrInvalidLogoURL
		}
	}
	return nil
}

// parseHex reads #rrggbb as channels in 0..1.
func parseHex(v string) ([3]float64, bool) {
	var rgb [3]float64
	if len(v) != 7 || v[0] != '#' {
		return rgb, false
	}
	for i := range rgb {
		n, err := strconv.ParseUint(v[1+2*i:3+2*i], 16, 8)
		if err != nil {
			return rgb, false
		}
		rgb[i] = float64(n) / 255
	}
	return rgb, true
}

// luminance is the WCAG relative luminance.
func luminance(rgb [3]float64) float64 {
	var lin [3]float64
	for i, c := range rgb {
		if c <= 0.03928 {
			lin[i] = c / 12.92
		} else {
			lin[i] = math.Pow((c+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*lin[0] + 0.7152*lin[1] + 0.0722*lin[2]
}

func contrast(a, b [3]float64) float64 {
	la, lb := luminance(a), luminance(b)
	return (math.Max(la, lb) + 0.05) / (math.Min(la, lb) + 0.05)
}
