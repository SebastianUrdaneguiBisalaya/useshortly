package link

import "context"

type Repository interface {
	Create(ctx context.Context, l Link) error // returns ErrCodeTaken if exists collision
	FindByCode(ctx context.Context, code string) (Link, error)
}
