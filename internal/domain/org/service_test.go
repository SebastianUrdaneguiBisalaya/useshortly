package org

import (
	"context"
	"errors"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	orgs    map[int64]Organization
	members []Member
	invs    map[int64]Invitation
	emails  map[int64]string // userID -> email, for IsMemberByEmail
	nextID  int64
}

type sentMail struct {
	code, to string
	cc, bcc  []string
	data     map[string]string
}

type fakeMailer struct {
	sent []sentMail
	err  error
}

func (m *fakeMailer) Send(_ context.Context, req mailing.Request) error {
	m.sent = append(m.sent, sentMail{req.Code, req.To, req.CC, req.BCC, req.Data})
	return m.err
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{orgs: map[int64]Organization{}, invs: map[int64]Invitation{}, emails: map[int64]string{}}
}

func (r *fakeRepo) id() int64 { r.nextID++; return r.nextID }

func (r *fakeRepo) CreateWithOwner(_ context.Context, o Organization, ownerID int64) (Organization, error) {
	for _, e := range r.orgs {
		if e.Name == o.Name {
			return Organization{}, ErrNameTaken
		}
	}
	o.ID = r.id()
	r.orgs[o.ID] = o
	r.members = append(r.members, Member{ID: r.id(), TenantID: o.ID, UserID: ownerID, Role: RoleOwner})
	return o, nil
}

func (r *fakeRepo) FindByID(_ context.Context, id int64) (Organization, error) {
	if o, ok := r.orgs[id]; ok {
		return o, nil
	}
	return Organization{}, ErrNotFound
}

func (r *fakeRepo) Update(_ context.Context, id int64, name, description string, _ time.Time) (Organization, error) {
	o, ok := r.orgs[id]
	if !ok {
		return Organization{}, ErrNotFound
	}
	for _, e := range r.orgs {
		if e.ID != id && e.Name == name {
			return Organization{}, ErrNameTaken
		}
	}
	o.Name, o.Description = name, description
	r.orgs[id] = o
	return o, nil
}

func (r *fakeRepo) SoftDelete(_ context.Context, id int64, _ time.Time) error {
	if _, ok := r.orgs[id]; !ok {
		return ErrNotFound
	}
	delete(r.orgs, id)
	kept := r.members[:0]
	for _, m := range r.members {
		if m.TenantID != id {
			kept = append(kept, m)
		}
	}
	r.members = kept
	return nil
}

func (r *fakeRepo) ListByUser(_ context.Context, userID int64) ([]Organization, error) {
	var out []Organization
	for _, m := range r.members {
		if m.UserID == userID {
			out = append(out, r.orgs[m.TenantID])
		}
	}
	return out, nil
}

func (r *fakeRepo) FindMember(_ context.Context, tenantID, userID int64) (Member, error) {
	for _, m := range r.members {
		if m.TenantID == tenantID && m.UserID == userID {
			return m, nil
		}
	}
	return Member{}, ErrNotMember
}

func (r *fakeRepo) ListMembers(_ context.Context, tenantID int64) ([]Member, error) {
	var out []Member
	for _, m := range r.members {
		if m.TenantID == tenantID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (r *fakeRepo) DeleteMember(_ context.Context, tenantID, userID int64) error {
	for i, m := range r.members {
		if m.TenantID == tenantID && m.UserID == userID {
			r.members = append(r.members[:i], r.members[i+1:]...)
			return nil
		}
	}
	return ErrNotMember
}

func (r *fakeRepo) IsMemberByEmail(_ context.Context, tenantID int64, email string) (bool, error) {
	for _, m := range r.members {
		if m.TenantID == tenantID && r.emails[m.UserID] == email {
			return true, nil
		}
	}
	return false, nil
}

func (r *fakeRepo) CreateInvitation(_ context.Context, inv Invitation, now time.Time) (Invitation, error) {
	for id, e := range r.invs {
		if e.TenantID == inv.TenantID && e.Email == inv.Email && e.Status == InvitationPending {
			if !e.IsExpired(now) {
				return Invitation{}, ErrInvitationExists
			}
			e.Status = InvitationRejected
			r.invs[id] = e
		}
	}
	inv.ID = r.id()
	r.invs[inv.ID] = inv
	return inv, nil
}

func (r *fakeRepo) FindInvitation(_ context.Context, id int64) (Invitation, error) {
	if inv, ok := r.invs[id]; ok {
		return inv, nil
	}
	return Invitation{}, ErrInvitationNotFound
}

func (r *fakeRepo) ListPendingInvitations(_ context.Context, tenantID int64) ([]Invitation, error) {
	var out []Invitation
	for _, inv := range r.invs {
		if inv.TenantID == tenantID && inv.Status == InvitationPending {
			out = append(out, inv)
		}
	}
	return out, nil
}

func (r *fakeRepo) AcceptInvitation(_ context.Context, inv Invitation, userID int64, _ time.Time) (Member, error) {
	if _, err := r.FindMember(context.Background(), inv.TenantID, userID); err == nil {
		return Member{}, ErrAlreadyMember
	}
	inv.Status = InvitationAccepted
	r.invs[inv.ID] = inv
	m := Member{ID: r.id(), TenantID: inv.TenantID, UserID: userID, Role: inv.Role}
	r.members = append(r.members, m)
	return m, nil
}

func (r *fakeRepo) RejectInvitation(_ context.Context, id int64) error {
	inv := r.invs[id]
	inv.Status = InvitationRejected
	r.invs[id] = inv
	return nil
}

var ctx = context.Background()

// setup returns a service with org 1 owned by user 10 (owner@x.com).
func setup(t *testing.T) (*Service, *fakeRepo, Organization) {
	svc, repo, o, _ := setupAll(t)
	return svc, repo, o
}

func setupAll(t *testing.T) (*Service, *fakeRepo, Organization, *fakeMailer) {
	t.Helper()
	repo, mailer := newFakeRepo(), &fakeMailer{}
	repo.emails[10] = "owner@x.com"
	svc := NewService(repo, mailer)
	o, err := svc.CreateOrganization(ctx, 10, " Acme ", "")
	require.NoError(t, err)
	return svc, repo, o, mailer
}

func TestCreateOrganization(t *testing.T) {
	svc, repo, o := setup(t)
	assert.Equal(t, "Acme", o.Name)
	m, err := repo.FindMember(ctx, o.ID, 10)
	require.NoError(t, err)
	assert.Equal(t, RoleOwner, m.Role)

	_, err = svc.CreateOrganization(ctx, 11, "Acme", "")
	assert.ErrorIs(t, err, ErrNameTaken)
	_, err = svc.CreateOrganization(ctx, 11, "  ", "")
	assert.ErrorIs(t, err, ErrInvalidName)
	_, err = svc.CreateOrganization(ctx, 11, strings.Repeat("a", 256), "")
	assert.ErrorIs(t, err, ErrInvalidName)
	_, err = svc.CreateOrganization(ctx, 11, "ok", strings.Repeat("a", 256))
	assert.ErrorIs(t, err, ErrInvalidName)
}

func TestReadsRequireMembership(t *testing.T) {
	svc, _, o := setup(t)
	_, err := svc.Get(ctx, 99, o.ID)
	assert.ErrorIs(t, err, ErrNotMember)
	_, err = svc.ListMembers(ctx, 99, o.ID)
	assert.ErrorIs(t, err, ErrNotMember)
	_, err = svc.ListPendingInvitations(ctx, 99, o.ID)
	assert.ErrorIs(t, err, ErrNotMember)

	got, err := svc.Get(ctx, 10, o.ID)
	require.NoError(t, err)
	assert.Equal(t, o.ID, got.ID)
	mine, err := svc.ListMine(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, mine, 1)
}

func TestInvite(t *testing.T) {
	svc, _, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", " Bob@X.com ", InviteOptions{})
	require.NoError(t, err)
	assert.Equal(t, "bob@x.com", inv.Email)
	assert.Equal(t, RoleAdmin, inv.Role)
	assert.Equal(t, InvitationPending, inv.Status)
	require.NotNil(t, inv.ExpiresAt)
	assert.True(t, inv.ExpiresAt.After(inv.CreatedAt))

	_, err = svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	assert.ErrorIs(t, err, ErrInvitationExists)
	_, err = svc.Invite(ctx, 10, o.ID, "Owner", "owner@x.com", InviteOptions{})
	assert.ErrorIs(t, err, ErrAlreadyMember)
	_, err = svc.Invite(ctx, 10, o.ID, "Owner", "nope", InviteOptions{})
	assert.ErrorIs(t, err, ErrInvalidEmail)
	_, err = svc.Invite(ctx, 99, o.ID, "Eve", "z@x.com", InviteOptions{})
	assert.ErrorIs(t, err, ErrNotMember)

	pending, err := svc.ListPendingInvitations(ctx, 10, o.ID)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
}

func TestInviteSendsEmailAndSurvivesMailFailure(t *testing.T) {
	svc, _, o, mailer := setupAll(t)
	mailer.err = errors.New("provider down")

	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err, "a failing mailer must not fail the invitation")
	require.Len(t, mailer.sent, 1)
	got := mailer.sent[0]
	assert.Equal(t, "INVITATION", got.code)
	assert.Equal(t, "bob@x.com", got.to)
	assert.Equal(t, "Owner", got.data["InviterName"])
	assert.Equal(t, "Acme", got.data["OrganizationName"])
	assert.Equal(t, strconv.FormatInt(inv.ID, 10), got.data["InvitationID"])
	assert.NotEmpty(t, got.data["ExpiresAt"])
}

func TestRejectedInviteSendsNoEmail(t *testing.T) {
	svc, _, o, mailer := setupAll(t)
	_, err := svc.Invite(ctx, 10, o.ID, "Owner", "nope", InviteOptions{})
	assert.ErrorIs(t, err, ErrInvalidEmail)
	_, err = svc.Invite(ctx, 99, o.ID, "Eve", "bob@x.com", InviteOptions{})
	assert.ErrorIs(t, err, ErrNotMember)
	assert.Empty(t, mailer.sent)
}

func TestInviteAgainAfterExpiry(t *testing.T) {
	svc, _, o := setup(t)
	_, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	_, err = svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	assert.NoError(t, err)
}

func TestAcceptInvitation(t *testing.T) {
	svc, repo, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err)

	_, err = svc.AcceptInvitation(ctx, 20, "mallory@x.com", true, inv.ID)
	assert.ErrorIs(t, err, ErrInvitationNotFound, "invitation for another email")

	m, err := svc.AcceptInvitation(ctx, 20, "BOB@x.com", true, inv.ID)
	require.NoError(t, err)
	assert.Equal(t, RoleAdmin, m.Role)
	_, err = repo.FindMember(ctx, o.ID, 20)
	assert.NoError(t, err)

	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", true, inv.ID)
	assert.ErrorIs(t, err, ErrInvitationNotPending)
	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", true, 999)
	assert.ErrorIs(t, err, ErrInvitationNotFound)
}

func TestAcceptExpiredInvitation(t *testing.T) {
	svc, _, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", true, inv.ID)
	assert.ErrorIs(t, err, ErrInvitationExpired)
}

func TestRejectInvitation(t *testing.T) {
	svc, repo, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err)

	assert.ErrorIs(t, svc.RejectInvitation(ctx, "mallory@x.com", inv.ID), ErrInvitationNotFound)
	require.NoError(t, svc.RejectInvitation(ctx, "bob@x.com", inv.ID))
	assert.Equal(t, InvitationRejected, repo.invs[inv.ID].Status)
	assert.ErrorIs(t, svc.RejectInvitation(ctx, "bob@x.com", inv.ID), ErrInvitationNotPending)
}

func TestRemoveMember(t *testing.T) {
	svc, repo, o := setup(t)
	inv, _ := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	_, err := svc.AcceptInvitation(ctx, 20, "bob@x.com", true, inv.ID)
	require.NoError(t, err)

	assert.ErrorIs(t, svc.RemoveMember(ctx, 99, o.ID, 20), ErrNotMember, "actor must be a member")
	assert.ErrorIs(t, svc.RemoveMember(ctx, 20, o.ID, 10), ErrCannotRemoveOwner)
	assert.ErrorIs(t, svc.RemoveMember(ctx, 10, o.ID, 99), ErrNotMember)

	require.NoError(t, svc.RemoveMember(ctx, 10, o.ID, 20))
	_, err = repo.FindMember(ctx, o.ID, 20)
	assert.ErrorIs(t, err, ErrNotMember)
	_, err = svc.RequireMember(ctx, 20, o.ID)
	assert.ErrorIs(t, err, ErrNotMember, "access ends at once: every request re-checks membership")
}

func TestAcceptInvitationRequiresVerifiedEmail(t *testing.T) {
	svc, repo, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{})
	require.NoError(t, err)

	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", false, inv.ID)
	assert.ErrorIs(t, err, ErrEmailNotVerified)
	_, err = repo.FindMember(ctx, o.ID, 20)
	assert.ErrorIs(t, err, ErrNotMember)
	assert.Equal(t, InvitationPending, repo.invs[inv.ID].Status, "the invitation stays usable")
}

func TestInviteCopies(t *testing.T) {
	svc, _, o, mailer := setupAll(t)
	_, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{
		CC:  []string{" Boss@X.com ", "bob@x.com", "boss@x.com"},
		BCC: []string{"audit@x.com", "BOSS@x.com", "audit@x.com"},
	})
	require.NoError(t, err)
	require.Len(t, mailer.sent, 1)
	assert.Equal(t, "bob@x.com", mailer.sent[0].to)
	assert.Equal(t, []string{"boss@x.com"}, mailer.sent[0].cc, "normalized, deduplicated, recipient dropped")
	assert.Equal(t, []string{"audit@x.com"}, mailer.sent[0].bcc, "a hidden copy is never also a visible one")
}

func TestInviteRejectsInvalidCopiesBeforeCreatingAnything(t *testing.T) {
	svc, repo, o, mailer := setupAll(t)
	_, err := svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{CC: []string{"nope"}})
	assert.ErrorIs(t, err, ErrInvalidEmail)
	_, err = svc.Invite(ctx, 10, o.ID, "Owner", "bob@x.com", InviteOptions{BCC: []string{"Eve <eve@x.com>"}})
	assert.ErrorIs(t, err, ErrInvalidEmail)
	assert.Empty(t, repo.invs)
	assert.Empty(t, mailer.sent)
}

func TestRequireMember(t *testing.T) {
	svc, _, o := setup(t)
	m, err := svc.RequireMember(ctx, 10, o.ID)
	require.NoError(t, err)
	assert.Equal(t, RoleOwner, m.Role)
	_, err = svc.RequireMember(ctx, 99, o.ID)
	assert.ErrorIs(t, err, ErrNotMember)
	_, err = svc.RequireMember(ctx, 10, 999)
	assert.ErrorIs(t, err, ErrNotMember)
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestClockAdvancesAndIsUTC(t *testing.T) {
	s := NewService(nil, nil)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}

func TestNameIsPublicAndOnlyTheName(t *testing.T) {
	svc, _, o := setup(t)
	name, err := svc.Name(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "Acme", name, "no membership needed: it is shown to visitors")
	_, err = svc.Name(ctx, 9999)
	assert.ErrorIs(t, err, ErrNotFound)
}

type fakeWaker struct{ kicks int }

func (w *fakeWaker) Kick() { w.kicks++ }

func TestDeleteIsOwnerOnlyAndWakesThePurger(t *testing.T) {
	svc, repo, o := setup(t)
	waker := &fakeWaker{}
	svc.WithPurger(waker)
	repo.members = append(repo.members, Member{ID: repo.id(), TenantID: o.ID, UserID: 11, Role: RoleAdmin})

	assert.ErrorIs(t, svc.Delete(ctx, 11, o.ID), ErrNotOwner, "an admin cannot")
	assert.ErrorIs(t, svc.Delete(ctx, 99, o.ID), ErrNotMember)
	assert.Zero(t, waker.kicks)
	assert.Contains(t, repo.orgs, o.ID)

	require.NoError(t, svc.Delete(ctx, 10, o.ID))
	assert.Equal(t, 1, waker.kicks)
	assert.NotContains(t, repo.orgs, o.ID)
	assert.ErrorIs(t, svc.Delete(ctx, 10, o.ID), ErrNotMember, "gone for everyone, owner included")
}

func TestUpdateIsOwnerOnlyAndValidates(t *testing.T) {
	svc, repo, o := setup(t)
	repo.members = append(repo.members, Member{ID: repo.id(), TenantID: o.ID, UserID: 11, Role: RoleAdmin})
	other, err := svc.CreateOrganization(ctx, 12, "Other", "")
	require.NoError(t, err)

	_, err = svc.Update(ctx, 11, o.ID, "New", "d")
	assert.ErrorIs(t, err, ErrNotOwner, "an admin cannot")
	_, err = svc.Update(ctx, 99, o.ID, "New", "d")
	assert.ErrorIs(t, err, ErrNotMember)
	_, err = svc.Update(ctx, 10, o.ID, "  ", "d")
	assert.ErrorIs(t, err, ErrInvalidName)
	_, err = svc.Update(ctx, 10, o.ID, "New", strings.Repeat("x", 256))
	assert.ErrorIs(t, err, ErrInvalidName)
	_, err = svc.Update(ctx, 10, o.ID, other.Name, "")
	assert.ErrorIs(t, err, ErrNameTaken)

	got, err := svc.Update(ctx, 10, o.ID, " New ", " desc ")
	require.NoError(t, err)
	assert.Equal(t, "New", got.Name)
	assert.Equal(t, "desc", got.Description)
}
