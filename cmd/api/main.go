package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/google"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/mailing/logsender"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/mailing/resend"
	otpredis "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/otp/redis"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/cache"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/server"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	db, err := database.NewSQLite(ctx, database.SQLiteConfig{
		Path:      cfg.DatabasePath,
		RemoteURL: cfg.TursoDatabaseUrl,
		AuthToken: cfg.TursoAuthToken,
	})
	if err != nil {
		return err
	}
	defer db.Close()
	syncDone := make(chan struct{})
	go func() {
		defer close(syncDone)
		db.RunSync(ctx, cfg.SyncInterval)
	}()
	defer func() {
		stop()
		<-syncDone
	}()

	redisClient, err := cache.NewRedisClient(ctx, cfg.RedisUrl)
	if err != nil {
		return err
	}
	defer redisClient.Close()

	var sender mailing.Sender = logsender.New()
	if cfg.ResendAPIKey != "" {
		sender = resend.New(cfg.ResendAPIKey, cfg.MailFrom)
	} else {
		log.Println("RESEND_API_KEY is not set: emails are only logged, not sent")
	}

	var verifier user.GoogleVerifier
	if cfg.GoogleClientID != "" {
		if verifier, err = google.NewVerifier(ctx, cfg.GoogleClientID); err != nil {
			return err
		}
	} else {
		log.Println("GOOGLE_CLIENT_ID is not set: Google sign-in is disabled")
	}

	a := newApp(cfg, db.DB, adapters{codes: otpredis.NewStore(redisClient), sender: sender, google: verifier})
	// Let emails still in flight finish before the database and Redis close.
	defer a.mail.Wait()

	return server.NewServer(cfg.Port, a.handler).Run(ctx)
}
