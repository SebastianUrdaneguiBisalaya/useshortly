include .env
export

.PHONY: run test migrate-up migrate-down migrate-create

run:
	go run ./cmd/api

test:
	go test ./...

# Applies all pending migrations in migrations/ to DATABASE_URL.
# Requires the golang-migrate CLI: https://github.com/golang-migrate/migrate
migrate-up:
	migrate -path migrations -database "$(DATABASE_URL)" up

# Rolls back the last applied migration.
migrate-down:
	migrate -path migrations -database "$(DATABASE_URL)" down 1

# Creates a new pair of up/down migration files, e.g.:
#   make migrate-create name=create_products_table
migrate-create:
	migrate create -ext sql -dir migrations -seq $(name)