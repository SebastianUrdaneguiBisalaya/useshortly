package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

type EmailLogRepository struct {
	db *sql.DB
}

func NewEmailLogRepository(db *sql.DB) *EmailLogRepository {
	return &EmailLogRepository{db: db}
}

func (r *EmailLogRepository) Create(ctx context.Context, l mailing.EmailLog) error {
	cc, err := jsonList(l.CC)
	if err != nil {
		return fmt.Errorf("email log repo: cc: %w", err)
	}
	bcc, err := jsonList(l.BCC)
	if err != nil {
		return fmt.Errorf("email log repo: bcc: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO email_logs (template_id, to_email, cc, bcc, status, email_provider, email_provider_id, error_metadata, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.TemplateID, l.To, cc, bcc, string(l.Status), l.Provider,
		nullString(l.ProviderID), nullString(l.ErrorMetadata), formatTime(l.CreatedAt))
	if err != nil {
		return fmt.Errorf("email log repo: insert: %w", err)
	}
	return nil
}

// jsonList stores a list of emails as a JSON array, or NULL when there are none.
func jsonList(list []string) (any, error) {
	if len(list) == 0 {
		return nil, nil
	}
	b, err := json.Marshal(list)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}
