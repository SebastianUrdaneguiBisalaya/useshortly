package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
)

type OrgRepository struct {
	db *sql.DB
}

func NewOrgRepository(db *sql.DB) *OrgRepository {
	return &OrgRepository{db: db}
}

const (
	orgColumns    = `id, name, description, logo_url, created_at, updated_at`
	memberColumns = `id, tenant_id, user_id, role, created_at`
	invColumns    = `id, email, tenant_id, inviter_id, role, status, created_at, expires_at`
)

func (r *OrgRepository) CreateWithOwner(ctx context.Context, o org.Organization, ownerID int64) (org.Organization, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return org.Organization{}, fmt.Errorf("org repo: begin: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO organizations (name, description, logo_url, created_at) VALUES (?, ?, ?, ?)`,
		o.Name, nullString(o.Description), nullString(o.LogoURL), formatTime(o.CreatedAt))
	if isUniqueViolation(err) {
		return org.Organization{}, org.ErrNameTaken
	}
	if err != nil {
		return org.Organization{}, fmt.Errorf("org repo: insert organization: %w", err)
	}
	if o.ID, err = res.LastInsertId(); err != nil {
		return org.Organization{}, fmt.Errorf("org repo: organization id: %w", err)
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO org_members (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		o.ID, ownerID, string(org.RoleOwner), formatTime(o.CreatedAt))
	if err != nil {
		return org.Organization{}, fmt.Errorf("org repo: insert owner: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return org.Organization{}, fmt.Errorf("org repo: commit: %w", err)
	}
	return o, nil
}

func (r *OrgRepository) FindByID(ctx context.Context, id int64) (org.Organization, error) {
	o, err := scanOrg(r.db.QueryRowContext(ctx, `SELECT `+orgColumns+` FROM organizations WHERE id = ? AND deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return org.Organization{}, org.ErrNotFound
	}
	return o, err
}

func (r *OrgRepository) Update(ctx context.Context, id int64, name, description string, at time.Time) (org.Organization, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE organizations SET name = ?, description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		name, nullString(description), formatTime(at), id)
	if isUniqueViolation(err) {
		return org.Organization{}, org.ErrNameTaken
	}
	if err != nil {
		return org.Organization{}, fmt.Errorf("org repo: update: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return org.Organization{}, fmt.Errorf("org repo: update: %w", err)
	}
	if n == 0 {
		return org.Organization{}, org.ErrNotFound
	}
	return r.FindByID(ctx, id)
}

func (r *OrgRepository) SoftDelete(ctx context.Context, id int64, at time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("org repo: begin: %w", err)
	}
	defer tx.Rollback()
	if err := softDeleteOrg(ctx, tx, id, at); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("org repo: commit: %w", err)
	}
	return nil
}

// softDeleteOrg is the fast part of deleting an organization, run inside the caller's transaction:
// mark it, free its name for a new organization, and cut every way into it (members, invitations,
// API keys). Links, clicks and domains are left for the purger. Returns org.ErrNotFound if the
// organization does not exist or is already deleted.
func softDeleteOrg(ctx context.Context, tx *sql.Tx, id int64, at time.Time) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE organizations SET deleted_at = ?, name = substr(name, 1, 200) || '#deleted-' || id
		 WHERE id = ? AND deleted_at IS NULL`, formatTime(at), id)
	if err != nil {
		return fmt.Errorf("org repo: mark deleted: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("org repo: mark deleted: %w", err)
	}
	if n == 0 {
		return org.ErrNotFound
	}
	for _, table := range []string{"org_members", "org_invitations", "api_keys"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE tenant_id = ?`, id); err != nil {
			return fmt.Errorf("org repo: delete %s: %w", table, err)
		}
	}
	return nil
}

func (r *OrgRepository) ListByUser(ctx context.Context, userID int64) ([]org.Organization, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT o.id, o.name, o.description, o.logo_url, o.created_at, o.updated_at
		 FROM organizations o JOIN org_members m ON m.tenant_id = o.id
		 WHERE m.user_id = ? ORDER BY o.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("org repo: list by user: %w", err)
	}
	defer rows.Close()
	var out []org.Organization
	for rows.Next() {
		o, err := scanOrg(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *OrgRepository) FindMember(ctx context.Context, tenantID, userID int64) (org.Member, error) {
	m, err := scanMember(r.db.QueryRowContext(ctx,
		`SELECT `+memberColumns+` FROM org_members WHERE tenant_id = ? AND user_id = ?`, tenantID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return org.Member{}, org.ErrNotMember
	}
	return m, err
}

func (r *OrgRepository) ListMembers(ctx context.Context, tenantID int64) ([]org.Member, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT m.id, m.tenant_id, m.user_id, m.role, m.created_at, u.first_name, u.last_name, u.email, u.image_url
		 FROM org_members m JOIN users u ON u.id = m.user_id
		 WHERE m.tenant_id = ? ORDER BY m.id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("org repo: list members: %w", err)
	}
	defer rows.Close()
	var out []org.Member
	for rows.Next() {
		var (
			m               org.Member
			role, createdAt string
			image           sql.NullString
		)
		if err := rows.Scan(&m.ID, &m.TenantID, &m.UserID, &role, &createdAt, &m.FirstName, &m.LastName, &m.Email, &image); err != nil {
			return nil, fmt.Errorf("org repo: scan member: %w", err)
		}
		m.Role, m.ImageURL = org.Role(role), image.String
		var perr error
		if m.CreatedAt, perr = parseTime(createdAt); perr != nil {
			return nil, fmt.Errorf("org repo: member created_at: %w", perr)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *OrgRepository) DeleteMember(ctx context.Context, tenantID, userID int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM org_members WHERE tenant_id = ? AND user_id = ?`, tenantID, userID)
	if err != nil {
		return fmt.Errorf("org repo: delete member: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("org repo: delete member: %w", err)
	}
	if n == 0 {
		return org.ErrNotMember
	}
	return nil
}

func (r *OrgRepository) IsMemberByEmail(ctx context.Context, tenantID int64, email string) (bool, error) {
	var one int
	err := r.db.QueryRowContext(ctx,
		`SELECT 1 FROM org_members m JOIN users u ON u.id = m.user_id
		 WHERE m.tenant_id = ? AND lower(u.email) = lower(?)`, tenantID, email).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("org repo: member by email: %w", err)
	}
	return true, nil
}

func (r *OrgRepository) CreateInvitation(ctx context.Context, inv org.Invitation, now time.Time) (org.Invitation, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: begin: %w", err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx,
		`UPDATE org_invitations SET status = ?
		 WHERE tenant_id = ? AND lower(email) = lower(?) AND status = ? AND expires_at < ?`,
		string(org.InvitationRejected), inv.TenantID, inv.Email, string(org.InvitationPending), formatTime(now))
	if err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: retire expired invitations: %w", err)
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO org_invitations (email, tenant_id, inviter_id, role, status, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		inv.Email, inv.TenantID, inv.InviterID, string(inv.Role), string(inv.Status),
		formatTime(inv.CreatedAt), nullTime(inv.ExpiresAt))
	if isUniqueViolation(err) {
		return org.Invitation{}, org.ErrInvitationExists
	}
	if err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: insert invitation: %w", err)
	}
	if inv.ID, err = res.LastInsertId(); err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: invitation id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: commit: %w", err)
	}
	return inv, nil
}

func (r *OrgRepository) FindInvitation(ctx context.Context, id int64) (org.Invitation, error) {
	inv, err := scanInvitation(r.db.QueryRowContext(ctx, `SELECT `+invColumns+` FROM org_invitations WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return org.Invitation{}, org.ErrInvitationNotFound
	}
	return inv, err
}

func (r *OrgRepository) ListPendingInvitations(ctx context.Context, tenantID int64) ([]org.Invitation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+invColumns+` FROM org_invitations WHERE tenant_id = ? AND status = ? ORDER BY id`,
		tenantID, string(org.InvitationPending))
	if err != nil {
		return nil, fmt.Errorf("org repo: list invitations: %w", err)
	}
	defer rows.Close()
	var out []org.Invitation
	for rows.Next() {
		inv, err := scanInvitation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

func (r *OrgRepository) AcceptInvitation(ctx context.Context, inv org.Invitation, userID int64, now time.Time) (org.Member, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return org.Member{}, fmt.Errorf("org repo: begin: %w", err)
	}
	defer tx.Rollback()
	if err := setPendingStatus(ctx, tx, inv.ID, org.InvitationAccepted); err != nil {
		return org.Member{}, err
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO org_members (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		inv.TenantID, userID, string(inv.Role), formatTime(now))
	if isUniqueViolation(err) {
		return org.Member{}, org.ErrAlreadyMember
	}
	if err != nil {
		return org.Member{}, fmt.Errorf("org repo: insert member: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return org.Member{}, fmt.Errorf("org repo: member id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return org.Member{}, fmt.Errorf("org repo: commit: %w", err)
	}
	return org.Member{ID: id, TenantID: inv.TenantID, UserID: userID, Role: inv.Role, CreatedAt: now}, nil
}

func (r *OrgRepository) RejectInvitation(ctx context.Context, id int64) error {
	return setPendingStatus(ctx, r.db, id, org.InvitationRejected)
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// setPendingStatus only touches PENDING rows, so two concurrent answers cannot both win.
func setPendingStatus(ctx context.Context, db execer, id int64, status org.InvitationStatus) error {
	res, err := db.ExecContext(ctx,
		`UPDATE org_invitations SET status = ? WHERE id = ? AND status = ?`,
		string(status), id, string(org.InvitationPending))
	if err != nil {
		return fmt.Errorf("org repo: set invitation status: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("org repo: set invitation status: %w", err)
	}
	if n == 0 {
		return org.ErrInvitationNotPending
	}
	return nil
}

func scanOrg(s scanner) (org.Organization, error) {
	var (
		o                     org.Organization
		desc, logo, updatedAt sql.NullString
		createdAt             string
	)
	if err := s.Scan(&o.ID, &o.Name, &desc, &logo, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return org.Organization{}, err
		}
		return org.Organization{}, fmt.Errorf("org repo: scan organization: %w", err)
	}
	o.Description, o.LogoURL = desc.String, logo.String
	var err error
	if o.CreatedAt, err = parseTime(createdAt); err != nil {
		return org.Organization{}, fmt.Errorf("org repo: created_at: %w", err)
	}
	if o.UpdatedAt, err = parseNullTime(updatedAt); err != nil {
		return org.Organization{}, fmt.Errorf("org repo: updated_at: %w", err)
	}
	return o, nil
}

func scanMember(s scanner) (org.Member, error) {
	var (
		m         org.Member
		role      string
		createdAt string
	)
	if err := s.Scan(&m.ID, &m.TenantID, &m.UserID, &role, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return org.Member{}, err
		}
		return org.Member{}, fmt.Errorf("org repo: scan member: %w", err)
	}
	m.Role = org.Role(role)
	var err error
	if m.CreatedAt, err = parseTime(createdAt); err != nil {
		return org.Member{}, fmt.Errorf("org repo: member created_at: %w", err)
	}
	return m, nil
}

func scanInvitation(s scanner) (org.Invitation, error) {
	var (
		inv          org.Invitation
		role, status string
		createdAt    string
		expiresAt    sql.NullString
	)
	if err := s.Scan(&inv.ID, &inv.Email, &inv.TenantID, &inv.InviterID, &role, &status, &createdAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return org.Invitation{}, err
		}
		return org.Invitation{}, fmt.Errorf("org repo: scan invitation: %w", err)
	}
	inv.Role, inv.Status = org.Role(role), org.InvitationStatus(status)
	var err error
	if inv.CreatedAt, err = parseTime(createdAt); err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: invitation created_at: %w", err)
	}
	if inv.ExpiresAt, err = parseNullTime(expiresAt); err != nil {
		return org.Invitation{}, fmt.Errorf("org repo: invitation expires_at: %w", err)
	}
	return inv, nil
}
