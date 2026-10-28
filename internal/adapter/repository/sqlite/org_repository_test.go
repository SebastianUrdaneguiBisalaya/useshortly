package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var testCtx = context.Background()

func TestOrgRepositoryCreateAndRead(t *testing.T) {
	db := newDB(t)
	repo := NewOrgRepository(db)
	owner := newUser(t, NewUserRepository(db), "owner@x.com")
	now := time.Now().UTC().Truncate(time.Millisecond)

	o, err := repo.CreateWithOwner(testCtx, org.Organization{Name: "Acme", Description: "d", CreatedAt: now}, owner.ID)
	require.NoError(t, err)
	assert.NotZero(t, o.ID)

	got, err := repo.FindByID(testCtx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "Acme", got.Name)
	assert.Equal(t, "d", got.Description)
	assert.True(t, got.CreatedAt.Equal(now))

	_, err = repo.FindByID(testCtx, 999)
	assert.ErrorIs(t, err, org.ErrNotFound)

	m, err := repo.FindMember(testCtx, o.ID, owner.ID)
	require.NoError(t, err)
	assert.Equal(t, org.RoleOwner, m.Role)

	mine, err := repo.ListByUser(testCtx, owner.ID)
	require.NoError(t, err)
	require.Len(t, mine, 1)
	assert.Equal(t, o.ID, mine[0].ID)

	_, err = repo.CreateWithOwner(testCtx, org.Organization{Name: "Acme", CreatedAt: now}, owner.ID)
	assert.ErrorIs(t, err, org.ErrNameTaken)
	var orgs, members int
	require.NoError(t, db.QueryRowContext(testCtx, `SELECT count(*) FROM organizations`).Scan(&orgs))
	require.NoError(t, db.QueryRowContext(testCtx, `SELECT count(*) FROM org_members`).Scan(&members))
	assert.Equal(t, 1, orgs)
	assert.Equal(t, 1, members)
}

func TestOrgRepositoryInvitationFlow(t *testing.T) {
	db := newDB(t)
	repo := NewOrgRepository(db)
	users := NewUserRepository(db)
	owner := newUser(t, users, "owner@x.com")
	bob := newUser(t, users, "bob@x.com")
	now := time.Now().UTC().Truncate(time.Millisecond)
	exp := now.Add(time.Hour)

	o, err := repo.CreateWithOwner(testCtx, org.Organization{Name: "Acme", CreatedAt: now}, owner.ID)
	require.NoError(t, err)

	isMember, err := repo.IsMemberByEmail(testCtx, o.ID, "OWNER@x.com")
	require.NoError(t, err)
	assert.True(t, isMember)
	isMember, err = repo.IsMemberByEmail(testCtx, o.ID, "bob@x.com")
	require.NoError(t, err)
	assert.False(t, isMember)

	inv, err := repo.CreateInvitation(testCtx, org.Invitation{
		Email: "bob@x.com", TenantID: o.ID, InviterID: owner.ID, Role: org.RoleAdmin,
		Status: org.InvitationPending, CreatedAt: now, ExpiresAt: &exp,
	}, now)
	require.NoError(t, err)
	assert.NotZero(t, inv.ID)

	_, err = repo.CreateInvitation(testCtx, inv, now)
	assert.ErrorIs(t, err, org.ErrInvitationExists)

	got, err := repo.FindInvitation(testCtx, inv.ID)
	require.NoError(t, err)
	assert.Equal(t, org.InvitationPending, got.Status)
	require.NotNil(t, got.ExpiresAt)
	assert.True(t, got.ExpiresAt.Equal(exp))
	_, err = repo.FindInvitation(testCtx, 999)
	assert.ErrorIs(t, err, org.ErrInvitationNotFound)

	pending, err := repo.ListPendingInvitations(testCtx, o.ID)
	require.NoError(t, err)
	assert.Len(t, pending, 1)

	m, err := repo.AcceptInvitation(testCtx, got, bob.ID, now)
	require.NoError(t, err)
	assert.Equal(t, org.RoleAdmin, m.Role)
	got, _ = repo.FindInvitation(testCtx, inv.ID)
	assert.Equal(t, org.InvitationAccepted, got.Status)

	_, err = repo.AcceptInvitation(testCtx, got, bob.ID, now)
	assert.ErrorIs(t, err, org.ErrInvitationNotPending)
	assert.ErrorIs(t, repo.RejectInvitation(testCtx, inv.ID), org.ErrInvitationNotPending)

	members, err := repo.ListMembers(testCtx, o.ID)
	require.NoError(t, err)
	assert.Len(t, members, 2)
	for _, m := range members {
		assert.NotEmpty(t, m.Email)
		assert.NotEmpty(t, m.FirstName)
		assert.NotEmpty(t, m.LastName)
	}

	renamed, err := repo.Update(testCtx, o.ID, "Renamed", "desc", now)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", renamed.Name)
	assert.Equal(t, "desc", renamed.Description)
	assert.ErrorIs(t, func() error { _, e := repo.Update(testCtx, 9999, "X", "", now); return e }(), org.ErrNotFound)

	require.NoError(t, repo.DeleteMember(testCtx, o.ID, bob.ID))
	assert.ErrorIs(t, repo.DeleteMember(testCtx, o.ID, bob.ID), org.ErrNotMember)
	_, err = repo.FindMember(testCtx, o.ID, bob.ID)
	assert.ErrorIs(t, err, org.ErrNotMember)
}

func TestOrgRepositoryAcceptTwiceKeepsInvitationPending(t *testing.T) {
	db := newDB(t)
	repo := NewOrgRepository(db)
	users := NewUserRepository(db)
	owner := newUser(t, users, "owner@x.com")
	now := time.Now().UTC().Truncate(time.Millisecond)
	exp := now.Add(time.Hour)
	o, err := repo.CreateWithOwner(testCtx, org.Organization{Name: "Acme", CreatedAt: now}, owner.ID)
	require.NoError(t, err)
	inv, err := repo.CreateInvitation(testCtx, org.Invitation{
		Email: "owner@x.com", TenantID: o.ID, InviterID: owner.ID, Role: org.RoleAdmin,
		Status: org.InvitationPending, CreatedAt: now, ExpiresAt: &exp,
	}, now)
	require.NoError(t, err)

	// The owner is already a member: the accept must roll back, not consume the invitation.
	_, err = repo.AcceptInvitation(testCtx, inv, owner.ID, now)
	assert.ErrorIs(t, err, org.ErrAlreadyMember)
	got, err := repo.FindInvitation(testCtx, inv.ID)
	require.NoError(t, err)
	assert.Equal(t, org.InvitationPending, got.Status)
}

func TestOrgRepositoryRejectAndReinviteAfterExpiry(t *testing.T) {
	db := newDB(t)
	repo := NewOrgRepository(db)
	owner := newUser(t, NewUserRepository(db), "owner@x.com")
	now := time.Now().UTC().Truncate(time.Millisecond)
	o, err := repo.CreateWithOwner(testCtx, org.Organization{Name: "Acme", CreatedAt: now}, owner.ID)
	require.NoError(t, err)

	newInv := func(at time.Time) org.Invitation {
		exp := at.Add(time.Hour)
		return org.Invitation{
			Email: "bob@x.com", TenantID: o.ID, InviterID: owner.ID, Role: org.RoleAdmin,
			Status: org.InvitationPending, CreatedAt: at, ExpiresAt: &exp,
		}
	}
	first, err := repo.CreateInvitation(testCtx, newInv(now), now)
	require.NoError(t, err)
	require.NoError(t, repo.RejectInvitation(testCtx, first.ID))
	_, err = repo.CreateInvitation(testCtx, newInv(now), now)
	require.NoError(t, err, "rejected invitations do not block a new one")

	later := now.Add(2 * time.Hour) // the second invitation is now expired
	_, err = repo.CreateInvitation(testCtx, newInv(later), later)
	require.NoError(t, err, "expired pending invitation must not block a new one")
	pending, err := repo.ListPendingInvitations(testCtx, o.ID)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
}
