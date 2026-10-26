package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Env              string
	Port             string
	DatabasePath     string
	TursoDatabaseUrl string
	TursoAuthToken   string
	SyncInterval     time.Duration
	RedisUrl         string
	JWTSecret        string
	JWTTTL           time.Duration
	AppURL           string
	ResendAPIKey     string
	MailFrom         string
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	cfg := &Config{
		Env:              getEnv("ENVIRONMENT", "development"),
		Port:             getEnv("PORT", "8080"),
		DatabasePath:     getEnv("DATABASE_PATH", "useshortly.db"),
		TursoDatabaseUrl: getEnv("TURSO_DATABASE_URL", ""),
		TursoAuthToken:   getEnv("TURSO_AUTH_TOKEN", ""),
		RedisUrl:         getEnv("REDIS_URL", ""),
		JWTSecret:        getEnv("JWT_SECRET", ""),
		AppURL:           getEnv("APP_URL", "http://localhost:8080"),
		ResendAPIKey:     getEnv("RESEND_API_KEY", ""),
		MailFrom:         getEnv("MAIL_FROM", ""),
	}
	interval, err := time.ParseDuration(getEnv("SYNC_INTERVAL", "30s"))
	if err != nil || interval <= 0 {
		return nil, fmt.Errorf("SYNC_INTERVAL must be a positive duration like 30s")
	}
	cfg.SyncInterval = interval
	ttl, err := time.ParseDuration(getEnv("JWT_TTL", "24h"))
	if err != nil || ttl <= 0 {
		return nil, fmt.Errorf("JWT_TTL must be a positive duration like 24h")
	}
	cfg.JWTTTL = ttl
	if cfg.Env == "" {
		return nil, fmt.Errorf("ENVIRONMENT is not set")
	}
	if cfg.Port == "" {
		return nil, fmt.Errorf("PORT is not set")
	}
	if cfg.DatabasePath == "" {
		return nil, fmt.Errorf("DATABASE_PATH is not set")
	}
	if cfg.TursoDatabaseUrl != "" && cfg.TursoAuthToken == "" {
		return nil, fmt.Errorf("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set")
	}
	if cfg.RedisUrl == "" {
		return nil, fmt.Errorf("REDIS_URL is not set")
	}
	if len(cfg.JWTSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	if cfg.ResendAPIKey != "" && cfg.MailFrom == "" {
		return nil, fmt.Errorf("MAIL_FROM is required when RESEND_API_KEY is set")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
