package org

import (
	"context"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

const (
	maxFieldLen   = 255
	invitationTTL = 7 * 24 * time.Hour
)

// Mailer sends a template by code. Invite ignores the result, so wire an asynchronous,
// best-effort implementation (mailing.Async).
type Mailer interface {
	Send(ctx context.Context, code, to string, data map[string]string) error
}

// TokenRevoker invalidates the refresh tokens of a user inside one tenant.
type TokenRevoker interface {
	RevokeForMember(ctx context.Context, userID, tenantID int64) error
}

type Service struct {
	repo    Repository
	mailer  Mailer
	revoker TokenRevoker
	now     func() time.Time
}

func NewService(repo Repository, mailer Mailer, revoker TokenRevoker) *Service {
	return &Service{repo: repo, mailer: mailer, revoker: revoker, now: time.Now().UTC}
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

// RemoveMember lets any member remove another. The OWNER can never be removed. The
// removed member's refresh tokens are revoked first, so if that fails nothing changes and
// the call can be retried; once they are gone the member can no longer renew a session.
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
	if err := s.revoker.RevokeForMember(ctx, targetID, tenantID); err != nil {
		return err
	}
	return s.repo.DeleteMember(ctx, tenantID, targetID)
}

// Invite creates a pending ADMIN invitation for email and mails it. inviterName is shown
// in the email. A mail failure never fails the invitation.
func (s *Service) Invite(ctx context.Context, actorID, tenantID int64, inviterName, email string) (Invitation, error) {
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
	o, err := s.repo.FindByID(ctx, tenantID)
	if err != nil {
		return Invitation{}, err
	}
	now := s.now()
	expires := now.Add(invitationTTL)
	inv, err := s.repo.CreateInvitation(ctx, Invitation{
		Email:     email,
		TenantID:  tenantID,
		InviterID: actorID,
		Role:      RoleAdmin,
		Status:    InvitationPending,
		CreatedAt: now,
		ExpiresAt: &expires,
	}, now)
	if err != nil {
		return Invitation{}, err
	}
	_ = s.mailer.Send(ctx, mailing.TemplateInvitation, inv.Email, map[string]string{
		"InviterName":      inviterName,
		"OrganizationName": o.Name,
		"InvitationID":     strconv.FormatInt(inv.ID, 10),
		"ExpiresAt":        expires.Format("2006-01-02"),
	})
	return inv, nil
}

func (s *Service) ListPendingInvitations(ctx context.Context, actorID, tenantID int64) ([]Invitation, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return nil, err
	}
	return s.repo.ListPendingInvitations(ctx, tenantID)
}

// AcceptInvitation adds the user to the tenant. Invitations are matched by email, so the
// user must have a verified email: otherwise anyone could take an invitation by signing up
// with an address they do not own.
func (s *Service) AcceptInvitation(ctx context.Context, userID int64, userEmail string, emailVerified bool, invitationID int64) (Member, error) {
	if !emailVerified {
		return Member{}, ErrEmailNotVerified
	}
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
