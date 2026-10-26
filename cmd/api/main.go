package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
)

func main() {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer stop()
	cgf, err := config.Load()
	if err != nil {
		log.Fatalf("Config: %v", err)
	}
	db, err := database.NewSQLite(ctx, database.SQLiteConfig{
		Path:      cgf.DatabasePath,
		RemoteURL: cgf.TursoDatabaseUrl,
		AuthToken: cgf.TursoAuthToken,
	})
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	defer db.Close()
	syncDone := make(chan struct{})
	go func() {
		defer close(syncDone)
		db.RunSync(ctx, cgf.SyncInterval)
	}()
	defer func() {
		stop()
		<-syncDone
	}()

}
