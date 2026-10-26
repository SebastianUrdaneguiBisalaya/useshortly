package auth

import "errors"

var (
	ErrInvalidCredentials   = errors.New("auth: invalid credentials")
	ErrTokenExpired         = errors.New("auth: token expired")
	ErrGenerateToken        = errors.New("auth: error generating a token")
	ErrRefreshTokenNotFound = errors.New("auth: refresh token not found")
)
