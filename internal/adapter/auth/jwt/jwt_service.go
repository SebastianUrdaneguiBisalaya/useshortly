package jwt

import (
	"context"
	"errors"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
)

type JwtService struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewJwtService(secret string, ttl time.Duration) *JwtService {
	return &JwtService{
		secret: []byte(secret),
		ttl:    ttl,
		now:    time.Now,
	}
}

func (s *JwtService) Generate(_ context.Context, userID string) (auth.Token, error) {
	now := s.now()
	expiresAt := now.Add(s.ttl)
	claims := jwtlib.RegisteredClaims{
		Subject:   userID,
		IssuedAt:  jwtlib.NewNumericDate(now),
		ExpiresAt: jwtlib.NewNumericDate(expiresAt),
	}
	signed, err := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims).SignedString(s.secret)
	if err != nil {
		return auth.Token{}, auth.ErrGenerateToken
	}
	return auth.Token{Value: signed, ExpiresAt: expiresAt}, nil
}

func (s *JwtService) Validate(_ context.Context, tokenString string) (string, error) {
	claims := &jwtlib.RegisteredClaims{}
	token, err := jwtlib.ParseWithClaims(
		tokenString,
		claims,
		func(*jwtlib.Token) (any, error) { return s.secret, nil },
		jwtlib.WithValidMethods([]string{jwtlib.SigningMethodHS256.Alg()}),
		jwtlib.WithExpirationRequired(),
		jwtlib.WithTimeFunc(s.now),
	)
	if errors.Is(err, jwtlib.ErrTokenExpired) {
		return "", auth.ErrTokenExpired
	}
	if err != nil || !token.Valid || claims.Subject == "" {
		return "", auth.ErrInvalidCredentials
	}
	return claims.Subject, nil
}
