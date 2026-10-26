package auth

import "errors"

var ErrInvalidCredentials = errors.New("auth: invalid credentials")

var ErrGenerateToken = errors.New("auth: error generating a token")
