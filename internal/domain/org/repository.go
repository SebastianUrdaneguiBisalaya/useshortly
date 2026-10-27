package org

import (
	"context"
	"time"
)

// Repository covers the organization aggregate: organizations, org_members and org_invitations.
type Repository interface {
	// CreateWithOwner stores the organization and its OWNER member atomically.
	// Returns ErrNameTaken if the name exists.
	CreateWithOwner(ctx context.Context, o Organization, ownerID int64) (Organization, error)
	// FindByID returns ErrNotFound.
	FindByID(ctx context.Context, id int64) (Organization, error)
	ListByUser(ctx context.Context, userID int64) ([]Organization, error)
	// SoftDelete hides the organization at once, in one transaction: it marks it deleted, frees its
	// name and removes its members, invitations and API keys. Its links and clicks stay until the
	// Purger deletes them. Returns ErrNotFound if it does not exist or is already deleted.
	SoftDelete(ctx context.Context, id int64, at time.Time) error

	// FindMember returns ErrNotMember.
	FindMember(ctx context.Context, tenantID, userID int64) (Member, error)
	ListMembers(ctx context.Context, tenantID int64) ([]Member, error)
	// DeleteMember returns ErrNotMember.
	DeleteMember(ctx context.Context, tenantID, userID int64) error
	IsMemberByEmail(ctx context.Context, tenantID int64, email string) (bool, error)

	// CreateInvitation first retires expired pending invitations for the same email
	// (they would block the unique pending index), then returns ErrInvitationExists
	// if a live pending one remains.
	CreateInvitation(ctx context.Context, inv Invitation, now time.Time) (Invitation, error)
	// FindInvitation returns ErrInvitationNotFound.
	FindInvitation(ctx context.Context, id int64) (Invitation, error)
	ListPendingInvitations(ctx context.Context, tenantID int64) ([]Invitation, error)
	// AcceptInvitation marks it ACCEPTED and adds userID as a member atomically.
	// Returns ErrInvitationNotPending or ErrAlreadyMember.
	AcceptInvitation(ctx context.Context, inv Invitation, userID int64, now time.Time) (Member, error)
	// RejectInvitation marks it REJECTED. Returns ErrInvitationNotPending.
	RejectInvitation(ctx context.Context, id int64) error
}
