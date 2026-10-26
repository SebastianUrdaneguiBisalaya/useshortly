package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

type ClickRepository struct {
	db *sql.DB
}

func NewClickRepository(db *sql.DB) *ClickRepository {
	return &ClickRepository{db: db}
}

func (r *ClickRepository) Create(ctx context.Context, c analytics.Click) (analytics.Click, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO clicks (link_id, clicked_at, referrer, user_agent, country, device)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.LinkID, formatTime(c.At), c.Referrer, c.UserAgent, c.Country, c.Device)
	if err != nil {
		return analytics.Click{}, fmt.Errorf("click repo: insert: %w", err)
	}
	if c.ID, err = res.LastInsertId(); err != nil {
		return analytics.Click{}, fmt.Errorf("click repo: id: %w", err)
	}
	return c, nil
}
