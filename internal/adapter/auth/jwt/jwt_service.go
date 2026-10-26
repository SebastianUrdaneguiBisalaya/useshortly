package jwt

import (
	"context"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
)

type JwtService struct {
	secret []byte
	ttl    time.Duration
}

func NewJwtService(secret string, ttl time.Duration) *JwtService {
	return &JwtService{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

func (s *JwtService) Generate(_ context.Context, userId string) (string, error) {
	claims := jwtlib.RegisteredClaims{
		Subject:   userId,
		IssuedAt:  jwtlib.NewNumericDate(time.Now()),
		ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(s.ttl)),
	}
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return "", auth.ErrGenerateToken
	}
	return signed, nil
}

func (s *JwtService) Validate(_ context.Context, tokenString string) (string, error) {
	claims := &jwtlib.RegisteredClaims{}
	token, err := jwtlib.ParseWithClaims(tokenString, claims, func(t *jwtlib.Token) (any, error) {
		return s.secret, nil
	})
	if err != nil || !token.Valid {
		return "", auth.ErrInvalidCredentials
	}
	return claims.Subject, nil
}
