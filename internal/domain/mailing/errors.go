package mailing

import "errors"

var (
	ErrTemplateNotFound = errors.New("mailing: template not found")
	ErrInvalidRecipient = errors.New("mailing: invalid recipient")
)
