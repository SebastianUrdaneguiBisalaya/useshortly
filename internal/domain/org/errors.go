package org

import "errors"

var (
	ErrNotFound             = errors.New("org: not found")
	ErrNameTaken            = errors.New("org: name already taken")
	ErrInvalidName          = errors.New("org: invalid name")
	ErrInvalidEmail         = errors.New("org: invalid email")
	ErrNotMember            = errors.New("org: not a member")
	ErrAlreadyMember        = errors.New("org: already a member")
	ErrCannotRemoveOwner    = errors.New("org: the owner cannot be removed")
	ErrInvitationNotFound   = errors.New("org: invitation not found")
	ErrInvitationExists     = errors.New("org: a pending invitation already exists for this email")
	ErrInvitationExpired    = errors.New("org: invitation expired")
	ErrInvitationNotPending = errors.New("org: invitation is not pending")
)
