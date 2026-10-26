package org

import "time"

type Role string

const (
	RoleOwner Role = "OWNER"
	RoleAdmin Role = "ADMIN"
)

type InvitationStatus string

const (
	InvitationPending  InvitationStatus = "PENDING"
	InvitationAccepted InvitationStatus = "ACCEPTED"
	InvitationRejected InvitationStatus = "REJECTED"
)

// Organization is a tenant: links, api keys and members belong to it.
type Organization struct {
	ID          int64
	Name        string
	Description string
	LogoURL     string
	CreatedAt   time.Time
	UpdatedAt   *time.Time
}

type Member struct {
	ID        int64
	TenantID  int64
	UserID    int64
	Role      Role
	CreatedAt time.Time
}

// Invitation lets someone join a tenant as ADMIN. Email is stored lowercase.
type Invitation struct {
	ID        int64
	Email     string
	TenantID  int64
	InviterID int64
	Role      Role
	Status    InvitationStatus
	CreatedAt time.Time
	ExpiresAt *time.Time
}

func (i Invitation) IsExpired(now time.Time) bool {
	return i.ExpiresAt != nil && now.UTC().After(*i.ExpiresAt)
}
