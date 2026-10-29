package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type CampaignRepository struct {
	db *sql.DB
}

func NewCampaignRepository(db *sql.DB) *CampaignRepository {
	return &CampaignRepository{db: db}
}

// campaignSelect reads a campaign with how many channels and links it has.
const campaignSelect = `SELECT c.id, c.tenant_id, c.name, c.description,
	(SELECT count(*) FROM channels ch WHERE ch.campaign_id = c.id),
	(SELECT count(*) FROM links l JOIN channels ch ON ch.id = l.channel_id WHERE ch.campaign_id = c.id),
	c.created_by, c.created_at, c.updated_at
	FROM campaigns c `

func scanCampaign(row interface{ Scan(...any) error }) (campaign.Campaign, error) {
	var (
		c         campaign.Campaign
		createdBy sql.NullInt64
		updated   sql.NullString
		createdAt string
	)
	if err := row.Scan(&c.ID, &c.TenantID, &c.Name, &c.Description, &c.ChannelCount, &c.LinkCount, &createdBy, &createdAt, &updated); err != nil {
		return campaign.Campaign{}, err
	}
	c.CreatedBy = createdBy.Int64 // 0 once the user who created it was deleted
	var err error
	if c.CreatedAt, err = parseTime(createdAt); err != nil {
		return campaign.Campaign{}, fmt.Errorf("campaign repo: created_at: %w", err)
	}
	if c.UpdatedAt, err = parseNullTime(updated); err != nil {
		return campaign.Campaign{}, fmt.Errorf("campaign repo: updated_at: %w", err)
	}
	return c, nil
}

func (r *CampaignRepository) Create(ctx context.Context, c campaign.Campaign) (campaign.Campaign, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO campaigns (tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
		c.TenantID, c.Name, c.Description, nullCreator(c.CreatedBy), formatTime(c.CreatedAt))
	if isUniqueViolation(err) {
		return campaign.Campaign{}, campaign.ErrNameTaken
	}
	if err != nil {
		return campaign.Campaign{}, fmt.Errorf("campaign repo: insert: %w", err)
	}
	if c.ID, err = res.LastInsertId(); err != nil {
		return campaign.Campaign{}, fmt.Errorf("campaign repo: id: %w", err)
	}
	return c, nil
}

// nullCreator stores 0 (no user) as NULL.
func nullCreator(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func (r *CampaignRepository) FindByID(ctx context.Context, tenantID, id int64) (campaign.Campaign, error) {
	c, err := scanCampaign(r.db.QueryRowContext(ctx, campaignSelect+`WHERE c.id = ? AND c.tenant_id = ?`, id, tenantID))
	if errors.Is(err, sql.ErrNoRows) {
		return campaign.Campaign{}, campaign.ErrNotFound
	}
	if err != nil {
		return campaign.Campaign{}, fmt.Errorf("campaign repo: find: %w", err)
	}
	return c, nil
}

func (r *CampaignRepository) ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]campaign.Campaign, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM campaigns WHERE tenant_id = ?`, tenantID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("campaign repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx, campaignSelect+`WHERE c.tenant_id = ? ORDER BY c.id DESC LIMIT ? OFFSET ?`, tenantID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("campaign repo: list: %w", err)
	}
	defer rows.Close()
	var out []campaign.Campaign
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("campaign repo: list: %w", err)
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

// Update only matches the tenant's own campaigns, so another tenant's id looks like any unknown id.
func (r *CampaignRepository) Update(ctx context.Context, tenantID, id int64, name, description string, at time.Time) (campaign.Campaign, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE campaigns SET name = ?, description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
		name, description, formatTime(at), id, tenantID)
	if isUniqueViolation(err) {
		return campaign.Campaign{}, campaign.ErrNameTaken
	}
	if err := expectRow(res, err, "update", campaign.ErrNotFound); err != nil {
		return campaign.Campaign{}, err
	}
	return r.FindByID(ctx, tenantID, id)
}

// Delete only matches the tenant's own campaigns. Its channels go with it and the trigger of
// migration 000013 detaches their links.
func (r *CampaignRepository) Delete(ctx context.Context, tenantID, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM campaigns WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return expectRow(res, err, "delete", campaign.ErrNotFound)
}

func (r *CampaignRepository) CreateChannel(ctx context.Context, tenantID int64, ch campaign.Channel) (campaign.Channel, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO channels (campaign_id, name, created_at)
		 SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND tenant_id = ?)`,
		ch.CampaignID, ch.Name, formatTime(ch.CreatedAt), ch.CampaignID, tenantID)
	if isUniqueViolation(err) {
		return campaign.Channel{}, campaign.ErrChannelNameTaken
	}
	if err := expectRow(res, err, "insert channel", campaign.ErrNotFound); err != nil {
		return campaign.Channel{}, err
	}
	if ch.ID, err = res.LastInsertId(); err != nil {
		return campaign.Channel{}, fmt.Errorf("campaign repo: channel id: %w", err)
	}
	if err := r.db.QueryRowContext(ctx, `SELECT name FROM campaigns WHERE id = ?`, ch.CampaignID).Scan(&ch.CampaignName); err != nil {
		return campaign.Channel{}, fmt.Errorf("campaign repo: campaign name: %w", err)
	}
	return ch, nil
}

const channelSelect = `SELECT ch.id, ch.campaign_id, ch.name, c.name, ch.created_at
	FROM channels ch JOIN campaigns c ON c.id = ch.campaign_id `

func scanChannel(row interface{ Scan(...any) error }) (campaign.Channel, error) {
	var ch campaign.Channel
	var createdAt string
	if err := row.Scan(&ch.ID, &ch.CampaignID, &ch.Name, &ch.CampaignName, &createdAt); err != nil {
		return campaign.Channel{}, err
	}
	var err error
	if ch.CreatedAt, err = parseTime(createdAt); err != nil {
		return campaign.Channel{}, fmt.Errorf("campaign repo: channel created_at: %w", err)
	}
	return ch, nil
}

func (r *CampaignRepository) FindChannel(ctx context.Context, tenantID, id int64) (campaign.Channel, error) {
	ch, err := scanChannel(r.db.QueryRowContext(ctx, channelSelect+`WHERE ch.id = ? AND c.tenant_id = ?`, id, tenantID))
	if errors.Is(err, sql.ErrNoRows) {
		return campaign.Channel{}, campaign.ErrChannelNotFound
	}
	if err != nil {
		return campaign.Channel{}, fmt.Errorf("campaign repo: find channel: %w", err)
	}
	return ch, nil
}

func (r *CampaignRepository) ListChannels(ctx context.Context, tenantID, campaignID int64, p page.Params) ([]campaign.Channel, int, error) {
	if err := r.checkCampaign(ctx, tenantID, campaignID); err != nil {
		return nil, 0, err
	}
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM channels WHERE campaign_id = ?`, campaignID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("campaign repo: count channels: %w", err)
	}
	rows, err := r.db.QueryContext(ctx, channelSelect+`WHERE ch.campaign_id = ? ORDER BY ch.id LIMIT ? OFFSET ?`, campaignID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("campaign repo: list channels: %w", err)
	}
	defer rows.Close()
	var out []campaign.Channel
	for rows.Next() {
		ch, err := scanChannel(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("campaign repo: list channels: %w", err)
		}
		out = append(out, ch)
	}
	return out, total, rows.Err()
}

// DeleteChannel only matches a channel of the tenant's campaign. The trigger of migration 000013
// detaches its links.
func (r *CampaignRepository) DeleteChannel(ctx context.Context, tenantID, campaignID, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM channels WHERE id = ? AND campaign_id = ?
		 AND campaign_id IN (SELECT id FROM campaigns WHERE tenant_id = ?)`, id, campaignID, tenantID)
	return expectRow(res, err, "delete channel", campaign.ErrChannelNotFound)
}

func (r *CampaignRepository) Export(ctx context.Context, tenantID, campaignID int64, from, to time.Time) ([]campaign.ExportRow, error) {
	if err := r.checkCampaign(ctx, tenantID, campaignID); err != nil {
		return nil, err
	}
	window, args := ``, []any{}
	if !from.IsZero() {
		window += ` AND k.clicked_at >= ?`
		args = append(args, formatTime(from))
	}
	if !to.IsZero() {
		window += ` AND k.clicked_at < ?`
		args = append(args, formatTime(to))
	}
	args = append(args, campaignID, tenantID)
	rows, err := r.db.QueryContext(ctx,
		`SELECT l.id, l.code, d.host, l.origin_url, ch.name,
			(SELECT count(*) FROM clicks k WHERE k.link_id = l.id`+window+`), l.created_at
		 FROM links l JOIN channels ch ON ch.id = l.channel_id LEFT JOIN domains d ON d.id = l.domain_id
		 WHERE ch.campaign_id = ? AND l.tenant_id = ? ORDER BY l.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("campaign repo: export: %w", err)
	}
	defer rows.Close()
	var out []campaign.ExportRow
	for rows.Next() {
		var (
			e         campaign.ExportRow
			host      sql.NullString
			createdAt string
		)
		if err := rows.Scan(&e.LinkID, &e.Code, &host, &e.OriginURL, &e.Channel, &e.Clicks, &createdAt); err != nil {
			return nil, fmt.Errorf("campaign repo: export: %w", err)
		}
		e.DomainHost = host.String
		if e.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, fmt.Errorf("campaign repo: export created_at: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *CampaignRepository) checkCampaign(ctx context.Context, tenantID, campaignID int64) error {
	var one int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM campaigns WHERE id = ? AND tenant_id = ?`, campaignID, tenantID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return campaign.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("campaign repo: campaign: %w", err)
	}
	return nil
}

// expectRow turns a statement that changed no row into notFound.
func expectRow(res sql.Result, err error, op string, notFound error) error {
	if err != nil {
		return fmt.Errorf("campaign repo: %s: %w", op, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("campaign repo: %s: %w", op, err)
	}
	if n == 0 {
		return notFound
	}
	return nil
}
