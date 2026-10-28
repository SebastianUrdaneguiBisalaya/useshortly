package link

import "errors"

var (
	ErrNotFound         = errors.New("link: not found")
	ErrDomainsDisabled  = errors.New("link: custom domains are not enabled")
	ErrExpired          = errors.New("link: expired")
	ErrInvalidURL       = errors.New("link: invalid URL")
	ErrCodeTaken        = errors.New("link: code taken")
	ErrInvalidAlias     = errors.New("link: invalid alias")
	ErrAliasTaken       = errors.New("link: alias taken")
	ErrInvalidExpiry    = errors.New("link: invalid expiry")
	ErrInvalidMaxClicks = errors.New("link: invalid max clicks")
	ErrInvalidQRColor   = errors.New("link: invalid QR color")
	ErrLowQRContrast    = errors.New("link: QR colors have too little contrast")
	ErrInvalidLogoURL   = errors.New("link: invalid QR logo URL")
	ErrInvalidPassword  = errors.New("link: invalid password")
	// ErrPasswordRequired: the link is protected and must be unlocked first.
	ErrPasswordRequired = errors.New("link: password required")
	ErrWrongPassword    = errors.New("link: wrong password")
	ErrTooManyAttempts  = errors.New("link: too many attempts")
)
