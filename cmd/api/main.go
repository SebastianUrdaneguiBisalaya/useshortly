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
	pool, err := database.NewPostgresPool(ctx, cgf.DatabaseUrl)
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	defer pool.Close()

}
