package org

import (
	"context"
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
	t.Helper()
	repo := newFakeRepo()
	repo.emails[10] = "owner@x.com"
	svc := NewService(repo)
	o, err := svc.CreateOrganization(ctx, 10, " Acme ", "")
	require.NoError(t, err)
	return svc, repo, o
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
	inv, err := svc.Invite(ctx, 10, o.ID, " Bob@X.com ")
	require.NoError(t, err)
	assert.Equal(t, "bob@x.com", inv.Email)
	assert.Equal(t, RoleAdmin, inv.Role)
	assert.Equal(t, InvitationPending, inv.Status)
	require.NotNil(t, inv.ExpiresAt)
	assert.True(t, inv.ExpiresAt.After(inv.CreatedAt))

	_, err = svc.Invite(ctx, 10, o.ID, "bob@x.com")
	assert.ErrorIs(t, err, ErrInvitationExists)
	_, err = svc.Invite(ctx, 10, o.ID, "owner@x.com")
	assert.ErrorIs(t, err, ErrAlreadyMember)
	_, err = svc.Invite(ctx, 10, o.ID, "nope")
	assert.ErrorIs(t, err, ErrInvalidEmail)
	_, err = svc.Invite(ctx, 99, o.ID, "z@x.com")
	assert.ErrorIs(t, err, ErrNotMember)

	pending, err := svc.ListPendingInvitations(ctx, 10, o.ID)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
}

func TestInviteAgainAfterExpiry(t *testing.T) {
	svc, _, o := setup(t)
	_, err := svc.Invite(ctx, 10, o.ID, "bob@x.com")
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	_, err = svc.Invite(ctx, 10, o.ID, "bob@x.com")
	assert.NoError(t, err)
}

func TestAcceptInvitation(t *testing.T) {
	svc, repo, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "bob@x.com")
	require.NoError(t, err)

	_, err = svc.AcceptInvitation(ctx, 20, "mallory@x.com", inv.ID)
	assert.ErrorIs(t, err, ErrInvitationNotFound, "invitation for another email")

	m, err := svc.AcceptInvitation(ctx, 20, "BOB@x.com", inv.ID)
	require.NoError(t, err)
	assert.Equal(t, RoleAdmin, m.Role)
	_, err = repo.FindMember(ctx, o.ID, 20)
	assert.NoError(t, err)

	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", inv.ID)
	assert.ErrorIs(t, err, ErrInvitationNotPending)
	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", 999)
	assert.ErrorIs(t, err, ErrInvitationNotFound)
}

func TestAcceptExpiredInvitation(t *testing.T) {
	svc, _, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "bob@x.com")
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	_, err = svc.AcceptInvitation(ctx, 20, "bob@x.com", inv.ID)
	assert.ErrorIs(t, err, ErrInvitationExpired)
}

func TestRejectInvitation(t *testing.T) {
	svc, repo, o := setup(t)
	inv, err := svc.Invite(ctx, 10, o.ID, "bob@x.com")
	require.NoError(t, err)

	assert.ErrorIs(t, svc.RejectInvitation(ctx, "mallory@x.com", inv.ID), ErrInvitationNotFound)
	require.NoError(t, svc.RejectInvitation(ctx, "bob@x.com", inv.ID))
	assert.Equal(t, InvitationRejected, repo.invs[inv.ID].Status)
	assert.ErrorIs(t, svc.RejectInvitation(ctx, "bob@x.com", inv.ID), ErrInvitationNotPending)
}

func TestRemoveMember(t *testing.T) {
	svc, repo, o := setup(t)
	inv, _ := svc.Invite(ctx, 10, o.ID, "bob@x.com")
	_, err := svc.AcceptInvitation(ctx, 20, "bob@x.com", inv.ID)
	require.NoError(t, err)

	assert.ErrorIs(t, svc.RemoveMember(ctx, 99, o.ID, 20), ErrNotMember, "actor must be a member")
	assert.ErrorIs(t, svc.RemoveMember(ctx, 20, o.ID, 10), ErrCannotRemoveOwner)
	assert.ErrorIs(t, svc.RemoveMember(ctx, 10, o.ID, 99), ErrNotMember)

	require.NoError(t, svc.RemoveMember(ctx, 10, o.ID, 20))
	_, err = repo.FindMember(ctx, o.ID, 20)
	assert.ErrorIs(t, err, ErrNotMember)
}
