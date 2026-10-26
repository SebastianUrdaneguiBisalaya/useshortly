package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

type EmailTemplateRepository struct {
	db *sql.DB
}

func NewEmailTemplateRepository(db *sql.DB) *EmailTemplateRepository {
	return &EmailTemplateRepository{db: db}
}

func (r *EmailTemplateRepository) FindByCode(ctx context.Context, code string) (mailing.Template, error) {
	var (
		t         mailing.Template
		createdAt string
		updatedAt sql.NullString
	)
	err := r.db.QueryRowContext(ctx,
		`SELECT id, code, subject, body_html, body_text, created_at, updated_at
		 FROM email_templates WHERE code = ?`, code).
		Scan(&t.ID, &t.Code, &t.Subject, &t.BodyHTML, &t.BodyText, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return mailing.Template{}, mailing.ErrTemplateNotFound
	}
	if err != nil {
		return mailing.Template{}, fmt.Errorf("template repo: find: %w", err)
	}
	if t.CreatedAt, err = parseTime(createdAt); err != nil {
		return mailing.Template{}, fmt.Errorf("template repo: created_at: %w", err)
	}
	if t.UpdatedAt, err = parseNullTime(updatedAt); err != nil {
		return mailing.Template{}, fmt.Errorf("template repo: updated_at: %w", err)
	}
	return t, nil
}
