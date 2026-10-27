package config

import (
	"fmt"
	"os"
	"strconv"
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
	OTPSecret        string
	GoogleClientID   string
	GoogleSecret     string
	GoogleRedirect   string
	RefreshTTL       time.Duration
	LinkCacheTTL     time.Duration
	// GeoIPPath is a MaxMind .mmdb database; empty disables the country of clicks.
	GeoIPPath string
	// TrustProxy reads the visitor's address from X-Forwarded-For (set it behind a reverse proxy).
	TrustProxy bool
	// AbuseEmail is where visitors report a link from the unlock page; empty shows no report link.
	AbuseEmail string
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
		OTPSecret:        getEnv("OTP_SECRET", ""),
		GoogleClientID:   getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleSecret:     getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirect:   getEnv("GOOGLE_REDIRECT_URI", "postmessage"),
		GeoIPPath:        getEnv("GEOIP_DB_PATH", ""),
		AbuseEmail:       getEnv("ABUSE_EMAIL", ""),
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
	refreshTTL, err := time.ParseDuration(getEnv("REFRESH_TTL", "720h"))
	if err != nil || refreshTTL <= 0 {
		return nil, fmt.Errorf("REFRESH_TTL must be a positive duration like 720h")
	}
	cfg.RefreshTTL = refreshTTL
	linkCacheTTL, err := time.ParseDuration(getEnv("LINK_CACHE_TTL", "5m"))
	if err != nil || linkCacheTTL <= 0 {
		return nil, fmt.Errorf("LINK_CACHE_TTL must be a positive duration like 5m")
	}
	cfg.LinkCacheTTL = linkCacheTTL
	trustProxy, err := strconv.ParseBool(getEnv("TRUST_PROXY", "false"))
	if err != nil {
		return nil, fmt.Errorf("TRUST_PROXY must be true or false")
	}
	cfg.TrustProxy = trustProxy
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
	if len(cfg.OTPSecret) < 32 {
		return nil, fmt.Errorf("OTP_SECRET must be at least 32 characters")
	}
	if (cfg.GoogleClientID == "") != (cfg.GoogleSecret == "") {
		return nil, fmt.Errorf("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together")
	}
	if cfg.Env == "production" && cfg.ResendAPIKey == "" {
		return nil, fmt.Errorf("RESEND_API_KEY is required when ENVIRONMENT is production")
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
