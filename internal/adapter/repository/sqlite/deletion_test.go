package sqlite

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func count(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(query, args...).Scan(&n))
	return n
}

type deletionFixture struct {
	db                    *sql.DB
	users                 *UserRepository
	orgs                  *OrgRepository
	links                 *LinkRepository
	purge                 *OrgPurgeRepository
	ana, bob              user.User
	acme, globex          org.Organization // Ana owns acme, Bob owns globex and is an admin of acme
	acmeLink, bobAcmeLink link.Link
	globexLink            link.Link
	now                   time.Time
}

func newDeletionFixture(t *testing.T) deletionFixture {
	t.Helper()
	ctx := context.Background()
	db := newDB(t)
	f := deletionFixture{db: db, users: NewUserRepository(db), orgs: NewOrgRepository(db), links: NewLinkRepository(db), purge: NewOrgPurgeRepository(db)}
	f.now = time.Now().UTC().Truncate(time.Millisecond)
	f.ana, f.bob = newUser(t, f.users, "ana@example.com"), newUser(t, f.users, "bob@example.com")

	var err error
	f.acme, err = f.orgs.CreateWithOwner(ctx, org.Organization{Name: "Acme", CreatedAt: f.now}, f.ana.ID)
	require.NoError(t, err)
	f.globex, err = f.orgs.CreateWithOwner(ctx, org.Organization{Name: "Globex", CreatedAt: f.now}, f.bob.ID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO org_members (tenant_id, user_id, role) VALUES (?, ?, 'ADMIN')`, f.acme.ID, f.bob.ID)
	require.NoError(t, err)

	mk := func(code string, tenant, by int64) link.Link {
		l, err := f.links.Create(ctx, link.Link{Code: code, OriginURL: "https://example.com/" + code, TenantID: tenant, CreatedBy: by, CreatedAt: f.now})
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, `INSERT INTO clicks (link_id, clicked_at) VALUES (?, ?)`, l.ID, formatTime(f.now))
		require.NoError(t, err)
		return l
	}
	f.acmeLink = mk("acme001", f.acme.ID, f.ana.ID)
	f.bobAcmeLink = mk("acme002", f.acme.ID, f.bob.ID)
	f.globexLink = mk("glob001", f.globex.ID, f.bob.ID)
	_, err = db.ExecContext(ctx, `INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, scope) VALUES (?, ?, 'k', 'p', 'h1', 'read'), (?, ?, 'k', 'p', 'h2', 'read')`,
		f.acme.ID, f.ana.ID, f.globex.ID, f.bob.ID)
	require.NoError(t, err)
	return f
}

func TestSoftDeleteHidesTheOrganizationAtOnce(t *testing.T) {
	ctx := context.Background()
	f := newDeletionFixture(t)

	require.NoError(t, f.orgs.SoftDelete(ctx, f.acme.ID, f.now))
	assert.ErrorIs(t, f.orgs.SoftDelete(ctx, f.acme.ID, f.now), org.ErrNotFound, "twice")
	assert.ErrorIs(t, f.orgs.SoftDelete(ctx, 999, f.now), org.ErrNotFound)

	_, err := f.orgs.FindByID(ctx, f.acme.ID)
	assert.ErrorIs(t, err, org.ErrNotFound)
	_, err = f.orgs.FindMember(ctx, f.acme.ID, f.ana.ID)
	assert.ErrorIs(t, err, org.ErrNotMember)
	mine, err := f.orgs.ListByUser(ctx, f.bob.ID)
	require.NoError(t, err)
	assert.Len(t, mine, 1, "Bob keeps Globex only")
	_, err = f.links.FindByCode(ctx, nil, "acme001")
	assert.ErrorIs(t, err, link.ErrNotFound, "its links stop redirecting at once")
	assert.Zero(t, count(t, f.db, `SELECT count(*) FROM api_keys WHERE tenant_id = ?`, f.acme.ID))

	// Heavy rows are still there, waiting for the purger; the name is free again.
	assert.Equal(t, 2, count(t, f.db, `SELECT count(*) FROM links WHERE tenant_id = ?`, f.acme.ID))
	_, err = f.orgs.CreateWithOwner(ctx, org.Organization{Name: "Acme", CreatedAt: f.now}, f.ana.ID)
	assert.NoError(t, err)

	// The other organization is untouched.
	_, err = f.links.FindByCode(ctx, nil, "glob001")
	assert.NoError(t, err)
	assert.Equal(t, 1, count(t, f.db, `SELECT count(*) FROM api_keys`))
}

func TestPurgeStoreDeletesOnlySoftDeletedOrganizations(t *testing.T) {
	ctx := context.Background()
	f := newDeletionFixture(t)

	pending, err := f.purge.PendingDeletion(ctx, 10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	require.NoError(t, f.purge.DeleteOrganization(ctx, f.acme.ID), "a live organization is never deleted")
	assert.Equal(t, 2, count(t, f.db, `SELECT count(*) FROM organizations`))

	require.NoError(t, f.orgs.SoftDelete(ctx, f.acme.ID, f.now))
	pending, err = f.purge.PendingDeletion(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, []int64{f.acme.ID}, pending)

	ids, err := f.purge.LinkIDs(ctx, f.acme.ID, 1)
	require.NoError(t, err)
	require.Len(t, ids, 1)
	require.NoError(t, f.purge.DeleteLinks(ctx, f.acme.ID, ids))
	assert.Equal(t, 1, count(t, f.db, `SELECT count(*) FROM links WHERE tenant_id = ?`, f.acme.ID))
	assert.NoError(t, f.purge.DeleteLinks(ctx, f.acme.ID, nil))
	assert.Equal(t, 2, count(t, f.db, `SELECT count(*) FROM clicks`), "the clicks of the deleted link went with it")

	// Another organization's id in the list deletes nothing of it.
	require.NoError(t, f.purge.DeleteLinks(ctx, f.acme.ID, []int64{f.globexLink.ID}))
	assert.Equal(t, 1, count(t, f.db, `SELECT count(*) FROM links WHERE tenant_id = ?`, f.globex.ID))

	rest, err := f.purge.LinkIDs(ctx, f.acme.ID, 10)
	require.NoError(t, err)
	require.NoError(t, f.purge.DeleteLinks(ctx, f.acme.ID, rest))
	require.NoError(t, f.purge.DeleteOrganization(ctx, f.acme.ID))
	assert.Zero(t, count(t, f.db, `SELECT count(*) FROM organizations WHERE id = ?`, f.acme.ID))
	pending, _ = f.purge.PendingDeletion(ctx, 10)
	assert.Empty(t, pending)
}

func TestDeleteUserWithOrganizations(t *testing.T) {
	ctx := context.Background()
	f := newDeletionFixture(t)

	require.NoError(t, f.users.DeleteWithOrganizations(ctx, f.ana.ID, f.now))
	assert.ErrorIs(t, f.users.DeleteWithOrganizations(ctx, f.ana.ID, f.now), user.ErrNotFound)

	_, err := f.users.FindByID(ctx, f.ana.ID)
	assert.ErrorIs(t, err, user.ErrNotFound)
	assert.Zero(t, count(t, f.db, `SELECT count(*) FROM accounts WHERE user_id = ?`, f.ana.ID))
	_, err = f.orgs.FindByID(ctx, f.acme.ID)
	assert.ErrorIs(t, err, org.ErrNotFound, "the organization she owned is hidden")
	_, err = f.links.FindByCode(ctx, nil, "acme002")
	assert.ErrorIs(t, err, link.ErrNotFound)
	pending, _ := f.purge.PendingDeletion(ctx, 10)
	assert.Equal(t, []int64{f.acme.ID}, pending)

	// Bob and his organization are untouched, and his email can be registered again.
	_, err = f.users.FindByID(ctx, f.bob.ID)
	assert.NoError(t, err)
	_, err = f.orgs.FindMember(ctx, f.globex.ID, f.bob.ID)
	assert.NoError(t, err)
	_ = newUser(t, f.users, "ana@example.com")
}

func TestLinksOutliveTheMemberWhoCreatedThem(t *testing.T) {
	ctx := context.Background()
	f := newDeletionFixture(t)

	// Bob is only an admin of Acme: leaving must not take his Acme link, nor Acme itself.
	require.NoError(t, f.users.DeleteWithOrganizations(ctx, f.bob.ID, f.now))

	got, err := f.links.FindByCode(ctx, nil, "acme002")
	require.NoError(t, err, "the link stays")
	assert.Zero(t, got.CreatedBy, "with no creator")
	_, err = f.orgs.FindByID(ctx, f.acme.ID)
	assert.NoError(t, err)
	_, err = f.orgs.FindMember(ctx, f.acme.ID, f.ana.ID)
	assert.NoError(t, err)

	// The organization Bob owned is hidden, and his API key (it acts as him) is gone.
	_, err = f.orgs.FindByID(ctx, f.globex.ID)
	assert.ErrorIs(t, err, org.ErrNotFound)
	assert.Zero(t, count(t, f.db, `SELECT count(*) FROM api_keys WHERE key_hash = 'h2'`))
	assert.Equal(t, 1, count(t, f.db, `SELECT count(*) FROM api_keys WHERE key_hash = 'h1'`))
}

func TestDeleteUserRollsBackCompletely(t *testing.T) {
	ctx := context.Background()
	f := newDeletionFixture(t)

	// The user row is deleted last, so a failure there must undo the organizations hidden before it.
	_, err := f.db.ExecContext(ctx, `CREATE TRIGGER boom BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'boom'); END`)
	require.NoError(t, err)

	err = f.users.DeleteWithOrganizations(ctx, f.ana.ID, f.now)
	require.Error(t, err)
	_, err = f.users.FindByID(ctx, f.ana.ID)
	assert.NoError(t, err, "the user is still there")
	_, err = f.orgs.FindByID(ctx, f.acme.ID)
	assert.NoError(t, err, "and so is the organization: the soft delete rolled back")
	pending, _ := f.purge.PendingDeletion(ctx, 10)
	assert.Empty(t, pending)
}
