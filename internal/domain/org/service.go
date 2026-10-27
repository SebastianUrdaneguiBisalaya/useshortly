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
	Send(ctx context.Context, req mailing.Request) error
}

type Service struct {
	repo   Repository
	mailer Mailer
	purger Waker
	now    func() time.Time
}

// Waker is told that there is something to purge, so the purger does not wait for its next tick.
type Waker interface {
	Kick()
}

// WithPurger makes Delete wake the purger as soon as it commits.
func (s *Service) WithPurger(p Waker) *Service {
	s.purger = p
	return s
}

func NewService(repo Repository, mailer Mailer) *Service {
	return &Service{repo: repo, mailer: mailer, now: func() time.Time { return time.Now().UTC() }}
}

// CreateOrganization creates a tenant owned by ownerID.
func (s *Service) CreateOrganization(ctx context.Context, ownerID int64, name, description string) (Organization, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if name == "" || utf8.RuneCountInString(name) > maxFieldLen || utf8.RuneCountInString(description) > maxFieldLen {
		return Organization{}, ErrInvalidName
	}
	return s.repo.CreateWithOwner(ctx, Organization{Name: name, Description: description, CreatedAt: s.now()}, ownerID)
}

// Delete removes the organization with its members, invitations, API keys, domains, links and
// clicks. Only the OWNER can. It answers once the organization is hidden; the heavy rows are
// deleted afterwards by the Purger, which keeps retrying until they are gone.
func (s *Service) Delete(ctx context.Context, actorID, tenantID int64) error {
	m, err := s.repo.FindMember(ctx, tenantID, actorID)
	if err != nil {
		return err
	}
	if m.Role != RoleOwner {
		return ErrNotOwner
	}
	if err := s.repo.SoftDelete(ctx, tenantID, s.now()); err != nil {
		return err
	}
	if s.purger != nil {
		s.purger.Kick()
	}
	return nil
}

// RequireMember returns ErrNotMember unless userID belongs to the tenant. Other services
// (api keys, links) call it before acting on a tenant on someone's behalf.
func (s *Service) RequireMember(ctx context.Context, userID, tenantID int64) (Member, error) {
	return s.repo.FindMember(ctx, tenantID, userID)
}

func (s *Service) Get(ctx context.Context, actorID, tenantID int64) (Organization, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return Organization{}, err
	}
	return s.repo.FindByID(ctx, tenantID)
}

// Name is the display name of an organization, for pages any visitor can see (no membership
// check: it must never return anything else about the organization).
func (s *Service) Name(ctx context.Context, tenantID int64) (string, error) {
	o, err := s.repo.FindByID(ctx, tenantID)
	if err != nil {
		return "", err
	}
	return o.Name, nil
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

// RemoveMember lets any member remove another. The OWNER can never be removed. Access ends
// at once: every request re-checks membership, whatever tokens the member still holds.
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

// InviteOptions are the optional extra recipients of the invitation email.
type InviteOptions struct {
	CC  []string // visible copies
	BCC []string // hidden copies
}

// Invite creates a pending ADMIN invitation for email and mails it, with the copies in
// opts if any. inviterName is shown in the email. A mail failure never fails the invitation.
func (s *Service) Invite(ctx context.Context, actorID, tenantID int64, inviterName, email string, opts InviteOptions) (Invitation, error) {
	if _, err := s.repo.FindMember(ctx, tenantID, actorID); err != nil {
		return Invitation{}, err
	}
	email, err := normalizeEmail(email)
	if err != nil {
		return Invitation{}, err
	}
	cc, err := normalizeEmails(opts.CC, email)
	if err != nil {
		return Invitation{}, err
	}
	bcc, err := normalizeEmails(opts.BCC, email, cc...)
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
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateInvitation, To: inv.Email, CC: cc, BCC: bcc, Data: map[string]string{
		"InviterName":      inviterName,
		"OrganizationName": o.Name,
		"InvitationID":     strconv.FormatInt(inv.ID, 10),
		"ExpiresAt":        expires.Format("2006-01-02"),
	}})
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

// normalizeEmails lowercases and validates the addresses, dropping duplicates and any
// already listed in exclude (the recipient, or the visible copies for the hidden ones).
func normalizeEmails(emails []string, exclude string, alsoExclude ...string) ([]string, error) {
	seen := map[string]bool{exclude: true}
	for _, e := range alsoExclude {
		seen[e] = true
	}
	var out []string
	for _, raw := range emails {
		e, err := normalizeEmail(raw)
		if err != nil {
			return nil, err
		}
		if !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	return out, nil
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > maxFieldLen {
		return "", ErrInvalidEmail
	}
	return email, nil
}
