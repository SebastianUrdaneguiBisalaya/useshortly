package sqlite

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

func TestCampaignRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewCampaignRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)

	now := time.Now().UTC().Truncate(time.Millisecond)
	created, err := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "Launch", Description: "d", CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)
	assert.NotZero(t, created.ID)

	got, err := repo.FindByID(ctx, 1, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "Launch", got.Name)
	assert.Equal(t, "d", got.Description)
	assert.Equal(t, u.ID, got.CreatedBy)
	assert.True(t, got.CreatedAt.Equal(now))
	assert.Nil(t, got.UpdatedAt)

	_, err = repo.FindByID(ctx, 2, created.ID)
	assert.ErrorIs(t, err, campaign.ErrNotFound, "another tenant's campaign looks unknown")

	_, err = repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "LAUNCH", CreatedAt: now})
	assert.ErrorIs(t, err, campaign.ErrNameTaken, "names are unique ignoring case")
	_, err = repo.Create(ctx, campaign.Campaign{TenantID: 2, Name: "Launch", CreatedAt: now})
	assert.NoError(t, err, "another tenant may reuse the name")

	other, err := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "Other", CreatedAt: now})
	require.NoError(t, err)
	_, err = repo.Update(ctx, 1, other.ID, "launch", "", now)
	assert.ErrorIs(t, err, campaign.ErrNameTaken)
	updated, err := repo.Update(ctx, 1, created.ID, "Launch 2", "", now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, "Launch 2", updated.Name)
	require.NotNil(t, updated.UpdatedAt)
	assert.True(t, updated.UpdatedAt.Equal(now.Add(time.Minute)))
	_, err = repo.Update(ctx, 2, created.ID, "x", "", now)
	assert.ErrorIs(t, err, campaign.ErrNotFound)

	list, total, err := repo.ListByTenant(ctx, 1, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 2, total)
	require.Len(t, list, 2)
	assert.Equal(t, "Other", list[0].Name, "newest first")

	assert.ErrorIs(t, repo.Delete(ctx, 2, created.ID), campaign.ErrNotFound)
	require.NoError(t, repo.Delete(ctx, 1, created.ID))
	_, err = repo.FindByID(ctx, 1, created.ID)
	assert.ErrorIs(t, err, campaign.ErrNotFound)
}

func TestCampaignRepositoryChannels(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewCampaignRepository(db)
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	a, err := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	require.NoError(t, err)
	b, err := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "B", CreatedAt: now})
	require.NoError(t, err)

	ch, err := repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	require.NoError(t, err)
	assert.NotZero(t, ch.ID)
	assert.Equal(t, "A", ch.CampaignName)

	_, err = repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "instagram", CreatedAt: now})
	assert.ErrorIs(t, err, campaign.ErrChannelNameTaken)
	_, err = repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: b.ID, Name: "Instagram", CreatedAt: now})
	assert.NoError(t, err, "the same name in another campaign is fine")
	_, err = repo.CreateChannel(ctx, 2, campaign.Channel{CampaignID: a.ID, Name: "Email", CreatedAt: now})
	assert.ErrorIs(t, err, campaign.ErrNotFound, "another tenant cannot add to the campaign")

	found, err := repo.FindChannel(ctx, 1, ch.ID)
	require.NoError(t, err)
	assert.Equal(t, "Instagram", found.Name)
	assert.Equal(t, "A", found.CampaignName)
	_, err = repo.FindChannel(ctx, 2, ch.ID)
	assert.ErrorIs(t, err, campaign.ErrChannelNotFound)

	list, total, err := repo.ListChannels(ctx, 1, a.ID, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, list, 1)
	_, _, err = repo.ListChannels(ctx, 2, a.ID, page.Params{Limit: 10})
	assert.ErrorIs(t, err, campaign.ErrNotFound)

	assert.ErrorIs(t, repo.DeleteChannel(ctx, 1, b.ID, ch.ID), campaign.ErrChannelNotFound, "the channel is in another campaign")
	assert.ErrorIs(t, repo.DeleteChannel(ctx, 2, a.ID, ch.ID), campaign.ErrChannelNotFound)
	require.NoError(t, repo.DeleteChannel(ctx, 1, a.ID, ch.ID))
}

// insertLink adds a link straight into the table, in a channel (0 for none), so these tests do not
// depend on the link repository.
func insertLink(t *testing.T, db *sql.DB, code string, channelID, tenantID, userID int64) int64 {
	t.Helper()
	res, err := db.ExecContext(context.Background(),
		`INSERT INTO links (code, origin_url, tenant_id, created_by, channel_id) VALUES (?, 'https://example.com', ?, ?, ?)`,
		code, tenantID, userID, nullChannel(channelID))
	require.NoError(t, err)
	id, err := res.LastInsertId()
	require.NoError(t, err)
	return id
}

func nullChannel(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func insertClick(t *testing.T, db *sql.DB, linkID int64, at time.Time) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO clicks (link_id, clicked_at) VALUES (?, ?)`, linkID, formatTime(at))
	require.NoError(t, err)
}

func TestCampaignRepositoryDeletingDetachesLinks(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewCampaignRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC()
	a, _ := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	insta, _ := repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	mail, _ := repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Email", CreatedAt: now})
	l1 := insertLink(t, db, "link0001", insta.ID, 1, u.ID)
	l2 := insertLink(t, db, "link0002", mail.ID, 1, u.ID)
	insertLink(t, db, "link0003", 0, 1, u.ID)

	got, err := repo.FindByID(ctx, 1, a.ID)
	require.NoError(t, err)
	assert.EqualValues(t, 2, got.ChannelCount)
	assert.EqualValues(t, 2, got.LinkCount)

	channelOf := func(id int64) any {
		var v any
		require.NoError(t, db.QueryRowContext(ctx, `SELECT channel_id FROM links WHERE id = ?`, id).Scan(&v))
		return v
	}
	require.NoError(t, repo.DeleteChannel(ctx, 1, a.ID, insta.ID))
	assert.Nil(t, channelOf(l1), "deleting a channel detaches its links")
	assert.NotNil(t, channelOf(l2))

	require.NoError(t, repo.Delete(ctx, 1, a.ID))
	assert.Nil(t, channelOf(l2), "deleting a campaign detaches the links of its channels")
	var links int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM links`).Scan(&links))
	assert.Equal(t, 3, links, "the links themselves stay")
}

func TestCampaignRepositoryExport(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewCampaignRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)
	now := time.Now().UTC()
	a, _ := repo.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	insta, _ := repo.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	l1 := insertLink(t, db, "link0001", insta.ID, 1, u.ID)
	l2 := insertLink(t, db, "link0002", insta.ID, 1, u.ID)
	insertLink(t, db, "link0003", 0, 1, u.ID) // outside the campaign

	day := func(d int) time.Time { return time.Date(2026, 1, d, 12, 0, 0, 0, time.UTC) }
	insertClick(t, db, l1, day(1))
	insertClick(t, db, l1, day(2))
	insertClick(t, db, l1, day(3))
	insertClick(t, db, l2, day(2))

	rows, err := repo.Export(ctx, 1, a.ID, time.Time{}, time.Time{})
	require.NoError(t, err)
	require.Len(t, rows, 2)
	assert.Equal(t, "link0001", rows[0].Code)
	assert.Equal(t, "Instagram", rows[0].Channel)
	assert.Equal(t, "https://example.com", rows[0].OriginURL)
	assert.Empty(t, rows[0].DomainHost)
	assert.EqualValues(t, 3, rows[0].Clicks)
	assert.EqualValues(t, 1, rows[1].Clicks)

	rows, err = repo.Export(ctx, 1, a.ID, time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.EqualValues(t, 1, rows[0].Clicks, "only the clicks inside the window")
	assert.EqualValues(t, 1, rows[1].Clicks)

	_, err = repo.Export(ctx, 2, a.ID, time.Time{}, time.Time{})
	assert.ErrorIs(t, err, campaign.ErrNotFound)
}
