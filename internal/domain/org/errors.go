package org

import "errors"

var (
	ErrNotFound             = errors.New("org: not found")
	ErrNameTaken            = errors.New("org: name already taken")
	ErrInvalidName          = errors.New("org: invalid name")
	ErrInvalidEmail         = errors.New("org: invalid email")
	ErrNotMember            = errors.New("org: not a member")
	ErrAlreadyMember        = errors.New("org: already a member")
	ErrNotOwner             = errors.New("org: only the owner can do this")
	ErrCannotRemoveOwner    = errors.New("org: the owner cannot be removed")
	ErrInvitationNotFound   = errors.New("org: invitation not found")
	ErrInvitationExists     = errors.New("org: a pending invitation already exists for this email")
	ErrInvitationExpired    = errors.New("org: invitation expired")
	ErrEmailNotVerified     = errors.New("org: the email must be verified")
	ErrInvitationNotPending = errors.New("org: invitation is not pending")
)
