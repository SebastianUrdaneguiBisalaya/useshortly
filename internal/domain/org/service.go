package org

import (
	"context"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxFieldLen   = 255
	invitationTTL = 7 * 24 * time.Hour
)

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now().UTC}
}

// CreateOrganization creates a tenant owned by ownerID.
func (s *Service) CreateOrganization(ctx context.Context, ownerID int64, name, description string) (Organization, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if name == "" || utf8.RuneCountInString(name) > maxFieldLen || utf8.RuneCountInString(description) > maxFieldLen {
		return Organization{}, ErrInvalidName
	}
	return s.repo.CreateWithOwner(ctx, Organization{Name: name, Description: description, CreatedAt: s.now()}, ownerID)
}

func (s *Service) Get(ctx context.Context, actorID, tenantID int64) (Organization, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return Organization{}, err
	}
	return s.repo.FindByID(ctx, tenantID)
}

// ListMine returns the organizations the user belongs to.
func (s *Service) ListMine(ctx context.Context, userID int64) ([]Organization, error) {
	return s.repo.ListByUser(ctx, userID)
}

func (s *Service) ListMembers(ctx context.Context, actorID, tenantID int64) ([]Member, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return nil, err
	}
	return s.repo.ListMembers(ctx, tenantID)
}

// RemoveMember lets any member remove another. The OWNER can never be removed.
func (s *Service) RemoveMember(ctx context.Context, actorID, tenantID, targetID int64) error {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return err
	}
	target, err := s.repo.FindMember(ctx, tenantID, targetID)
	if err != nil {
		return err
	}
	if target.Role == RoleOwner {
		return ErrCannotRemoveOwner
	}
	return s.repo.DeleteMember(ctx, tenantID, targetID)
}

// Invite creates a pending ADMIN invitation for email.
func (s *Service) Invite(ctx context.Context, actorID, tenantID int64, email string) (Invitation, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return Invitation{}, err
	}
	email, err := normalizeEmail(email)
	if err != nil {
		return Invitation{}, err
	}
	isMember, err := s.repo.IsMemberByEmail(ctx, tenantID, email)
	if err != nil {
		return Invitation{}, err
	}
	if isMember {
		return Invitation{}, ErrAlreadyMember
	}
	now := s.now()
	expires := now.Add(invitationTTL)
	return s.repo.CreateInvitation(ctx, Invitation{
		Email:     email,
		TenantID:  tenantID,
		InviterID: actorID,
		Role:      RoleAdmin,
		Status:    InvitationPending,
		CreatedAt: now,
		ExpiresAt: &expires,
	}, now)
}

func (s *Service) ListPendingInvitations(ctx context.Context, actorID, tenantID int64) ([]Invitation, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return nil, err
	}
	return s.repo.ListPendingInvitations(ctx, tenantID)
}

// AcceptInvitation adds the user (whose verified email is userEmail) to the tenant.
func (s *Service) AcceptInvitation(ctx context.Context, userID int64, userEmail string, invitationID int64) (Member, error) {
	inv, err := s.ownInvitation(ctx, userEmail, invitationID)
	if err != nil {
		return Member{}, err
	}
	return s.repo.AcceptInvitation(ctx, inv, userID, s.now())
}

func (s *Service) RejectInvitation(ctx context.Context, userEmail string, invitationID int64) error {
	inv, err := s.ownInvitation(ctx, userEmail, invitationID)
	if err != nil {
		return err
	}
	return s.repo.RejectInvitation(ctx, inv.ID)
}

// ownInvitation loads a live pending invitation addressed to userEmail. An invitation
// for someone else is reported as not found so ids cannot be probed.
func (s *Service) ownInvitation(ctx context.Context, userEmail string, id int64) (Invitation, error) {
	inv, err := s.repo.FindInvitation(ctx, id)
	if err != nil {
		return Invitation{}, err
	}
	if !strings.EqualFold(strings.TrimSpace(userEmail), inv.Email) {
		return Invitation{}, ErrInvitationNotFound
	}
	if inv.Status != InvitationPending {
		return Invitation{}, ErrInvitationNotPending
	}
	if inv.IsExpired(s.now()) {
		return Invitation{}, ErrInvitationExpired
	}
	return inv, nil
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > maxFieldLen {
		return "", ErrInvalidEmail
	}
	return email, nil
}
