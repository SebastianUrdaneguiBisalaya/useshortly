package campaign

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type fakeRepo struct {
	campaigns map[int64]Campaign
	channels  map[int64]Channel
	nextID    int64
	exportErr error
	from, to  time.Time // the window Export was called with
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{campaigns: map[int64]Campaign{}, channels: map[int64]Channel{}}
}

func (r *fakeRepo) id() int64 { r.nextID++; return r.nextID }

func (r *fakeRepo) Create(_ context.Context, c Campaign) (Campaign, error) {
	for _, o := range r.campaigns {
		if o.TenantID == c.TenantID && strings.EqualFold(o.Name, c.Name) {
			return Campaign{}, ErrNameTaken
		}
	}
	c.ID = r.id()
	r.campaigns[c.ID] = c
	return c, nil
}

func (r *fakeRepo) FindByID(_ context.Context, tenantID, id int64) (Campaign, error) {
	c, ok := r.campaigns[id]
	if !ok || c.TenantID != tenantID {
		return Campaign{}, ErrNotFound
	}
	return c, nil
}

func (r *fakeRepo) ListByTenant(_ context.Context, tenantID int64, p page.Params) ([]Campaign, int, error) {
	var all []Campaign
	for _, c := range r.campaigns {
		if c.TenantID == tenantID {
			all = append(all, c)
		}
	}
	return all[:min(p.Limit, len(all))], len(all), nil
}

func (r *fakeRepo) Update(_ context.Context, tenantID, id int64, name, description string, at time.Time) (Campaign, error) {
	c, err := r.FindByID(context.Background(), tenantID, id)
	if err != nil {
		return Campaign{}, err
	}
	for _, o := range r.campaigns {
		if o.ID != id && o.TenantID == tenantID && strings.EqualFold(o.Name, name) {
			return Campaign{}, ErrNameTaken
		}
	}
	c.Name, c.Description, c.UpdatedAt = name, description, &at
	r.campaigns[id] = c
	return c, nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID, id int64) error {
	if _, err := r.FindByID(context.Background(), tenantID, id); err != nil {
		return err
	}
	delete(r.campaigns, id)
	return nil
}

func (r *fakeRepo) CreateChannel(ctx context.Context, tenantID int64, ch Channel) (Channel, error) {
	c, err := r.FindByID(ctx, tenantID, ch.CampaignID)
	if err != nil {
		return Channel{}, err
	}
	for _, o := range r.channels {
		if o.CampaignID == ch.CampaignID && strings.EqualFold(o.Name, ch.Name) {
			return Channel{}, ErrChannelNameTaken
		}
	}
	ch.ID, ch.CampaignName = r.id(), c.Name
	r.channels[ch.ID] = ch
	return ch, nil
}

func (r *fakeRepo) FindChannel(ctx context.Context, tenantID, id int64) (Channel, error) {
	ch, ok := r.channels[id]
	if !ok {
		return Channel{}, ErrChannelNotFound
	}
	if _, err := r.FindByID(ctx, tenantID, ch.CampaignID); err != nil {
		return Channel{}, ErrChannelNotFound
	}
	return ch, nil
}

func (r *fakeRepo) ListChannels(ctx context.Context, tenantID, campaignID int64, p page.Params) ([]Channel, int, error) {
	if _, err := r.FindByID(ctx, tenantID, campaignID); err != nil {
		return nil, 0, err
	}
	var all []Channel
	for _, ch := range r.channels {
		if ch.CampaignID == campaignID {
			all = append(all, ch)
		}
	}
	return all[:min(p.Limit, len(all))], len(all), nil
}

func (r *fakeRepo) DeleteChannel(ctx context.Context, tenantID, campaignID, id int64) error {
	ch, err := r.FindChannel(ctx, tenantID, id)
	if err != nil || ch.CampaignID != campaignID {
		return ErrChannelNotFound
	}
	delete(r.channels, id)
	return nil
}

func (r *fakeRepo) Export(ctx context.Context, tenantID, campaignID int64, from, to time.Time) ([]ExportRow, error) {
	if _, err := r.FindByID(ctx, tenantID, campaignID); err != nil {
		return nil, err
	}
	r.from, r.to = from, to
	return nil, r.exportErr
}

func newService(t *testing.T) (*Service, *fakeRepo) {
	t.Helper()
	repo := newFakeRepo()
	s := NewService(repo)
	s.now = func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC) }
	return s, repo
}

func TestCreate(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)

	c, err := s.Create(ctx, CreateInput{TenantID: 1, UserID: 9, Name: "  Black Friday  ", Description: " Sale links "})
	require.NoError(t, err)
	assert.Equal(t, "Black Friday", c.Name)
	assert.Equal(t, "Sale links", c.Description)
	assert.EqualValues(t, 9, c.CreatedBy)
	assert.Equal(t, s.now(), c.CreatedAt)

	tests := []struct {
		name string
		in   CreateInput
		want error
	}{
		{"empty name", CreateInput{TenantID: 1, Name: "   "}, ErrInvalidName},
		{"long name", CreateInput{TenantID: 1, Name: strings.Repeat("a", 101)}, ErrInvalidName},
		{"control character", CreateInput{TenantID: 1, Name: "a\x00b"}, ErrInvalidName},
		{"long description", CreateInput{TenantID: 1, Name: "ok", Description: strings.Repeat("a", 501)}, ErrInvalidDescription},
		{"same name, any case", CreateInput{TenantID: 1, Name: "black friday"}, ErrNameTaken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := s.Create(ctx, tt.in)
			assert.ErrorIs(t, err, tt.want)
		})
	}

	_, err = s.Create(ctx, CreateInput{TenantID: 2, Name: "Black Friday"})
	assert.NoError(t, err, "another tenant may reuse the name")
}

func TestCreateNameCountsCharactersNotBytes(t *testing.T) {
	s, _ := newService(t)
	_, err := s.Create(context.Background(), CreateInput{TenantID: 1, Name: strings.Repeat("ñ", 100)})
	assert.NoError(t, err)
}

func TestUpdate(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "A", Description: "first"})
	_, _ = s.Create(ctx, CreateInput{TenantID: 1, Name: "B"})

	name := "A2"
	got, err := s.Update(ctx, UpdateInput{TenantID: 1, ID: a.ID, Name: &name})
	require.NoError(t, err)
	assert.Equal(t, "A2", got.Name)
	assert.Equal(t, "first", got.Description, "a nil field is left as it is")
	require.NotNil(t, got.UpdatedAt)

	empty := ""
	got, err = s.Update(ctx, UpdateInput{TenantID: 1, ID: a.ID, Description: &empty})
	require.NoError(t, err)
	assert.Empty(t, got.Description, "an empty description clears it")

	taken := "b"
	_, err = s.Update(ctx, UpdateInput{TenantID: 1, ID: a.ID, Name: &taken})
	assert.ErrorIs(t, err, ErrNameTaken)

	blank := " "
	_, err = s.Update(ctx, UpdateInput{TenantID: 1, ID: a.ID, Name: &blank})
	assert.ErrorIs(t, err, ErrInvalidName)

	_, err = s.Update(ctx, UpdateInput{TenantID: 2, ID: a.ID, Name: &name})
	assert.ErrorIs(t, err, ErrNotFound, "another tenant's campaign looks unknown")
}

func TestGetListDelete(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "A"})

	_, err := s.Get(ctx, 2, a.ID)
	assert.ErrorIs(t, err, ErrNotFound)

	list, total, err := s.List(ctx, 1, page.Params{})
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, 1, total)

	assert.ErrorIs(t, s.Delete(ctx, 2, a.ID), ErrNotFound)
	require.NoError(t, s.Delete(ctx, 1, a.ID))
	_, err = s.Get(ctx, 1, a.ID)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestAddChannel(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "Launch"})

	ch, err := s.AddChannel(ctx, 1, a.ID, " Instagram ")
	require.NoError(t, err)
	assert.Equal(t, "Instagram", ch.Name)
	assert.Equal(t, a.ID, ch.CampaignID)

	_, err = s.AddChannel(ctx, 1, a.ID, "instagram")
	assert.ErrorIs(t, err, ErrChannelNameTaken)
	_, err = s.AddChannel(ctx, 1, a.ID, "")
	assert.ErrorIs(t, err, ErrInvalidChannelName)
	_, err = s.AddChannel(ctx, 1, a.ID, strings.Repeat("a", 51))
	assert.ErrorIs(t, err, ErrInvalidChannelName)
	_, err = s.AddChannel(ctx, 2, a.ID, "Email")
	assert.ErrorIs(t, err, ErrNotFound, "another tenant's campaign looks unknown")
}

func TestAddChannelStopsAtTheLimit(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "Launch"})
	for i := range MaxChannels {
		_, err := s.AddChannel(ctx, 1, a.ID, "channel "+string(rune('A'+i/26))+string(rune('a'+i%26)))
		require.NoError(t, err)
	}
	_, err := s.AddChannel(ctx, 1, a.ID, "one more")
	assert.ErrorIs(t, err, ErrTooManyChannels)
}

func TestDeleteChannel(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "A"})
	b, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "B"})
	ch, _ := s.AddChannel(ctx, 1, a.ID, "Email")

	assert.ErrorIs(t, s.DeleteChannel(ctx, 1, b.ID, ch.ID), ErrChannelNotFound, "the channel is in another campaign")
	assert.ErrorIs(t, s.DeleteChannel(ctx, 2, a.ID, ch.ID), ErrChannelNotFound)
	require.NoError(t, s.DeleteChannel(ctx, 1, a.ID, ch.ID))
	assert.ErrorIs(t, s.DeleteChannel(ctx, 1, a.ID, ch.ID), ErrChannelNotFound)
}

func TestResolve(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "Launch"})
	ch, _ := s.AddChannel(ctx, 1, a.ID, "Email")

	campaign, channel, err := s.Resolve(ctx, 1, ch.ID)
	require.NoError(t, err)
	assert.Equal(t, "Launch", campaign)
	assert.Equal(t, "Email", channel)

	_, _, err = s.Resolve(ctx, 2, ch.ID)
	assert.ErrorIs(t, err, ErrChannelNotFound)
}

func TestExport(t *testing.T) {
	ctx := context.Background()
	s, repo := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "A"})
	day := func(d int) time.Time { return time.Date(2026, 1, d, 15, 0, 0, 0, time.UTC) }

	rows, err := s.Export(ctx, 1, a.ID, time.Time{}, time.Time{}, nil)
	require.NoError(t, err)
	assert.NotNil(t, rows, "no links encodes as an empty list")
	assert.True(t, repo.from.IsZero() && repo.to.IsZero(), "no days counts every click")

	_, err = s.Export(ctx, 1, a.ID, day(10), day(12), nil)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC), repo.from)
	assert.Equal(t, time.Date(2026, 1, 13, 0, 0, 0, 0, time.UTC), repo.to, "the last day is included")

	_, err = s.Export(ctx, 1, a.ID, day(12), day(10), nil)
	assert.ErrorIs(t, err, ErrInvalidRange)
	_, err = s.Export(ctx, 1, a.ID, day(10), time.Time{}, nil)
	assert.NoError(t, err, "one open side is fine")
	_, err = s.Export(ctx, 2, a.ID, time.Time{}, time.Time{}, nil)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestExportCountsDaysInATimeZone(t *testing.T) {
	ctx := context.Background()
	s, repo := newService(t)
	a, _ := s.Create(ctx, CreateInput{TenantID: 1, Name: "A"})
	from, to := time.Date(2026, 3, 7, 0, 0, 0, 0, time.UTC), time.Date(2026, 3, 9, 0, 0, 0, 0, time.UTC)

	lima, err := time.LoadLocation("America/Lima")
	require.NoError(t, err)
	_, err = s.Export(ctx, 1, a.ID, from, to, lima)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 3, 7, 5, 0, 0, 0, time.UTC), repo.from.UTC(), "a Lima day starts at 05:00 UTC")
	assert.Equal(t, time.Date(2026, 3, 10, 5, 0, 0, 0, time.UTC), repo.to.UTC())

	// Clocks go forward on 8 March 2026 in New York, so the window ends at UTC-4.
	ny, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	_, err = s.Export(ctx, 1, a.ID, from, to, ny)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 3, 7, 5, 0, 0, 0, time.UTC), repo.from.UTC())
	assert.Equal(t, time.Date(2026, 3, 10, 4, 0, 0, 0, time.UTC), repo.to.UTC())
}
