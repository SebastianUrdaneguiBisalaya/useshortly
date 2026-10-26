include .env
export

.PHONY: run test migrate-up migrate-down migrate-create

run:
	go run ./cmd/api

test:
	go test ./...

# Migrations are plain SQL files applied with the sqlite3 CLI to DATABASE_PATH
# (golang-migrate has no driver for Turso). Write them idempotently (IF NOT EXISTS).
# Applies every migrations/*.up.sql in order.
migrate-up:
	@for f in $$(ls migrations/*.up.sql | sort); do echo "up: $$f"; sqlite3 "$(DATABASE_PATH)" < $$f || exit 1; done

# Applies one down migration, e.g.: make migrate-down file=migrations/000001_create_links_table.down.sql
migrate-down:
	sqlite3 "$(DATABASE_PATH)" < $(file)

# Creates a new pair of up/down migration files, e.g.:
#   make migrate-create name=create_products_table
migrate-create:
	@n=$$(printf "%06d" $$(( $$(ls migrations/*.up.sql 2>/dev/null | wc -l) + 1 ))); mkdir -p migrations; \
	touch migrations/$${n}_$(name).up.sql migrations/$${n}_$(name).down.sql; echo "created migrations/$${n}_$(name).{up,down}.sql"
