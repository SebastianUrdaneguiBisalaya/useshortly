package campaign

import "errors"

var (
	ErrNotFound           = errors.New("campaign: not found")
	ErrChannelNotFound    = errors.New("campaign: channel not found")
	ErrInvalidName        = errors.New("campaign: invalid name")
	ErrInvalidDescription = errors.New("campaign: invalid description")
	ErrNameTaken          = errors.New("campaign: name taken")
	ErrInvalidChannelName = errors.New("campaign: invalid channel name")
	ErrChannelNameTaken   = errors.New("campaign: channel name taken")
	ErrTooManyChannels    = errors.New("campaign: too many channels")
	ErrInvalidRange       = errors.New("campaign: invalid date range")
)
