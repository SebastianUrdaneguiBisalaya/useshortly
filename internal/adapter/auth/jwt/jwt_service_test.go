package jwt

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	jwtlib "github.com/golang-jwt/jwt/v5"
)

const secret = "0123456789abcdef0123456789abcdef"

func TestGenerateAndValidate(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	tok, err := svc.Generate(context.Background(), "42")
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(tok.ExpiresAt) - time.Hour; d > 5*time.Second || d < -5*time.Second {
		t.Fatalf("ExpiresAt = %v, want about 1h from now", tok.ExpiresAt)
	}
	id, err := svc.Validate(context.Background(), tok.Value)
	if err != nil || id != "42" {
		t.Fatalf("Validate = %q, %v; want 42, nil", id, err)
	}
}

func TestValidateExpired(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	tok, _ := svc.Generate(context.Background(), "42")
	svc.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if _, err := svc.Validate(context.Background(), tok.Value); !errors.Is(err, auth.ErrTokenExpired) {
		t.Fatalf("err = %v, want ErrTokenExpired", err)
	}
}

func TestValidateRejects(t *testing.T) {
	svc := NewJwtService(secret, time.Hour)
	other, _ := NewJwtService("another-secret-another-secret-0000", time.Hour).Generate(context.Background(), "42")
	none, _ := jwtlib.NewWithClaims(jwtlib.SigningMethodNone, jwtlib.RegisteredClaims{
		Subject:   "42",
		ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString(jwtlib.UnsafeAllowNoneSignatureType)
	noExp, _ := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, jwtlib.RegisteredClaims{Subject: "42"}).SignedString([]byte(secret))
	for name, token := range map[string]string{
		"wrong secret":  other.Value,
		"alg none":      none,
		"no expiration": noExp,
		"garbage":       "not-a-jwt",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.Validate(context.Background(), token); !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("err = %v, want ErrInvalidCredentials", err)
			}
		})
	}
}
