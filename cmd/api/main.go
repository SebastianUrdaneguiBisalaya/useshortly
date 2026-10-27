package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/google"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/geoip"
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

	var googleAuth user.GoogleAuth
	if cfg.GoogleClientID != "" {
		if googleAuth, err = google.New(ctx, cfg.GoogleClientID, cfg.GoogleSecret, cfg.GoogleRedirect); err != nil {
			return err
		}
	} else {
		log.Println("GOOGLE_CLIENT_ID is not set: Google sign-in is disabled")
	}

	ad := adapters{codes: otpredis.NewStore(redisClient), sender: sender, google: googleAuth, linkCache: cache.NewRedisStore(redisClient)}
	if cfg.GeoIPPath != "" {
		geo, err := geoip.Open(cfg.GeoIPPath)
		if err != nil {
			return err
		}
		defer geo.Close()
		ad.countries = geo
	} else {
		log.Println("GEOIP_DB_PATH is not set: the country of clicks is not recorded")
	}
	a := newApp(cfg, db.DB, ad)
	// Let emails still in flight finish before the database and Redis close.
	defer a.mail.Wait()
	// Flush the queued clicks before the database closes.
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.clicks.Close(ctx); err != nil {
			log.Printf("clicks not flushed: %v", err)
		}
	}()

	return server.NewServer(cfg.Port, a.handler).Run(ctx)
}
