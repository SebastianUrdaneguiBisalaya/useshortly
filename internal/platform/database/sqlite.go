package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	turso "turso.tech/database/tursogo"
)

// SQLiteConfig describes the local database file and, optionally, the Turso Cloud
// database it syncs with. Leave RemoteURL empty to run local-only.
type SQLiteConfig struct {
	Path      string
	RemoteURL string
	AuthToken string
}

// SQLite wraps the local database and the optional cloud sync handle.
type SQLite struct {
	DB   *sql.DB
	sync *turso.TursoSyncDb
}

func NewSQLite(ctx context.Context, cfg SQLiteConfig) (*SQLite, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	s := &SQLite{}
	if cfg.RemoteURL != "" {
		syncDb, err := turso.NewTursoSyncDb(ctx, turso.TursoSyncDbConfig{
			Path:      cfg.Path,
			RemoteUrl: cfg.RemoteURL,
			AuthToken: cfg.AuthToken,
		})
		if err != nil {
			return nil, fmt.Errorf("Database creating sync db: %w", err)
		}
		db, err := syncDb.Connect(ctx)
		if err != nil {
			return nil, fmt.Errorf("Database connect: %w", err)
		}
		s.DB, s.sync = db, syncDb
	} else {
		db, err := sql.Open("turso", cfg.Path)
		if err != nil {
			return nil, fmt.Errorf("Database open: %w", err)
		}
		s.DB = db
	}
	if err := s.DB.PingContext(ctx); err != nil {
		s.DB.Close()
		return nil, fmt.Errorf("Database ping: %w", err)
	}
	return s, nil
}

// Syncs reports whether the database is synchronized with Turso Cloud.
func (s *SQLite) Syncs() bool {
	return s.sync != nil
}

// Push sends local writes to Turso Cloud. No-op when running local-only.
func (s *SQLite) Push(ctx context.Context) error {
	if s.sync == nil {
		return nil
	}
	if err := s.sync.Push(ctx); err != nil {
		return fmt.Errorf("Database push: %w", err)
	}
	return nil
}

// Pull brings remote changes into the local database. No-op when running local-only.
func (s *SQLite) Pull(ctx context.Context) error {
	if s.sync == nil {
		return nil
	}
	if _, err := s.sync.Pull(ctx); err != nil {
		return fmt.Errorf("Database pull: %w", err)
	}
	return nil
}

// RunSync pulls and pushes every interval until ctx is cancelled, then does a final
// push so the last writes reach Turso Cloud. No-op when running local-only.
func (s *SQLite) RunSync(ctx context.Context, interval time.Duration) {
	if s.sync == nil {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			flushCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := s.Push(flushCtx); err != nil {
				log.Printf("Database final sync: %v", err)
			}
			return
		case <-ticker.C:
			if err := s.Pull(ctx); err != nil {
				log.Printf("Database sync: %v", err)
			}
			if err := s.Push(ctx); err != nil {
				log.Printf("Database sync: %v", err)
			}
		}
	}
}

func (s *SQLite) Close() error {
	return s.DB.Close()
}
