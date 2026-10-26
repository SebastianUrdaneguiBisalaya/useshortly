package auth

import "context"

type TokenService interface {
	Generate(ctx context.Context, userId string)
	Validate(ctx context.Context, token string) (userId string, err error)
}
