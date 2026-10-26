package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Env         string
	Port        string
	DatabaseUrl string
	RedisUrl    string
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	cfg := &Config{
		Env:         getEnv("ENVIRONMENT", "development"),
		Port:        getEnv("PORT", "8080"),
		DatabaseUrl: getEnv("DATABASE_URL", ""),
		RedisUrl:    getEnv("REDIS_URL", ""),
	}
	if cfg.Env == "" {
		return nil, fmt.Errorf("ENVIRONMENT is not set")
	}
	if cfg.Port == "" {
		return nil, fmt.Errorf("PORT is not set")
	}
	if cfg.DatabaseUrl == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	if cfg.RedisUrl == "" {
		return nil, fmt.Errorf("REDIS_URL is not set")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
