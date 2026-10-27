package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type DomainRepository struct {
	db *sql.DB
}

func NewDomainRepository(db *sql.DB) *DomainRepository {
	return &DomainRepository{db: db}
}

const domainColumns = `id, tenant_id, host, verified_at, created_at`

func (r *DomainRepository) Create(ctx context.Context, d domain.Domain) (domain.Domain, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO domains (tenant_id, host, verified_at, created_at) VALUES (?, ?, ?, ?)`,
		d.TenantID, d.Host, nullTime(d.VerifiedAt), formatTime(d.CreatedAt))
	if isUniqueViolation(err) {
		return domain.Domain{}, domain.ErrHostTaken
	}
	if err != nil {
		return domain.Domain{}, fmt.Errorf("domain repo: insert: %w", err)
	}
	if d.ID, err = res.LastInsertId(); err != nil {
		return domain.Domain{}, fmt.Errorf("domain repo: id: %w", err)
	}
	return d, nil
}

func (r *DomainRepository) FindByID(ctx context.Context, tenantID, id int64) (domain.Domain, error) {
	return r.find(ctx, `id = ? AND tenant_id = ?`, id, tenantID)
}

func (r *DomainRepository) FindByHost(ctx context.Context, host string) (domain.Domain, error) {
	return r.find(ctx, `host = ? AND tenant_id NOT IN (SELECT id FROM organizations WHERE deleted_at IS NOT NULL)`, host)
}

func (r *DomainRepository) find(ctx context.Context, where string, args ...any) (domain.Domain, error) {
	d, err := scanDomain(r.db.QueryRowContext(ctx, `SELECT `+domainColumns+` FROM domains WHERE `+where, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Domain{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Domain{}, fmt.Errorf("domain repo: find: %w", err)
	}
	return d, nil
}

func (r *DomainRepository) ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]domain.Domain, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM domains WHERE tenant_id = ?`, tenantID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("domain repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+domainColumns+` FROM domains WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
		tenantID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("domain repo: list: %w", err)
	}
	defer rows.Close()
	var out []domain.Domain
	for rows.Next() {
		d, err := scanDomain(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("domain repo: list: %w", err)
		}
		out = append(out, d)
	}
	return out, total, rows.Err()
}

func (r *DomainRepository) MarkVerified(ctx context.Context, tenantID, id int64, at time.Time) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE domains SET verified_at = ? WHERE id = ? AND tenant_id = ?`, formatTime(at), id, tenantID)
	return expectOne(res, err, "mark verified")
}

func (r *DomainRepository) Delete(ctx context.Context, tenantID, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM domains WHERE id = ? AND tenant_id = ?`, id, tenantID)
	return expectOne(res, err, "delete")
}

func expectOne(res sql.Result, err error, op string) error {
	if err != nil {
		return fmt.Errorf("domain repo: %s: %w", op, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("domain repo: %s: %w", op, err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func scanDomain(row interface{ Scan(...any) error }) (domain.Domain, error) {
	var (
		d         domain.Domain
		verified  sql.NullString
		createdAt string
	)
	if err := row.Scan(&d.ID, &d.TenantID, &d.Host, &verified, &createdAt); err != nil {
		return domain.Domain{}, err
	}
	var err error
	if d.VerifiedAt, err = parseNullTime(verified); err != nil {
		return domain.Domain{}, fmt.Errorf("verified_at: %w", err)
	}
	if d.CreatedAt, err = parseTime(createdAt); err != nil {
		return domain.Domain{}, fmt.Errorf("created_at: %w", err)
	}
	return d, nil
}
