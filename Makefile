include .env
export

.PHONY: run test openapi migrate-up migrate-down migrate-create

# swag is installed with `go install github.com/swaggo/swag/v2/cmd/swag@latest`, which puts it in
# GOPATH/bin; calling it from there means the target works even when that folder is not on PATH.
SWAG := $(shell go env GOPATH)/bin/swag

run:
	go run ./cmd/api

test:
	go test ./...

# Generates the OpenAPI 3.1 spec from the handler annotations into api/openapi/swagger.json, for
# Orval and the MCP server to consume. openapi-fix then patches what swag cannot say (the QR image).
openapi:
	$(SWAG) init --v3.1 -g main.go -d cmd/api,internal/adapter/http/handler --parseInternal --propertyStrategy snakecase -o api/openapi --outputTypes json
	go run ./scripts/openapi-fix api/openapi/swagger.json

# Migrations are plain SQL files applied with the sqlite3 CLI to DATABASE_PATH
# (golang-migrate has no driver for Turso). Each file is applied once and recorded in
# schema_migrations, because some of them rebuild tables and must not run twice. -bail stops at the
# first error, and the table rebuilds run in a transaction, so a failure changes nothing.
# Databases created before schema_migrations existed already have 000001 to 000010.
migrate-up:
	@db="$(DATABASE_PATH)"; \
	fresh=$$(sqlite3 "$$db" "SELECT count(*) FROM sqlite_master WHERE name = 'schema_migrations'"); \
	sqlite3 "$$db" "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))"; \
	if [ "$$fresh" = 0 ] && [ "$$(sqlite3 "$$db" "SELECT count(*) FROM sqlite_master WHERE name = 'links'")" != 0 ]; then \
		for f in $$(ls migrations/*.up.sql | sort | head -n 10); do sqlite3 "$$db" "INSERT INTO schema_migrations (name) VALUES ('$$(basename $$f)')"; done; \
		echo "existing database: 000001 to 000010 marked as applied"; \
	fi; \
	for f in $$(ls migrations/*.up.sql | sort); do \
		n=$$(basename $$f); \
		if [ -n "$$(sqlite3 "$$db" "SELECT 1 FROM schema_migrations WHERE name = '$$n'")" ]; then echo "skip: $$f"; continue; fi; \
		echo "up: $$f"; \
		sqlite3 -bail "$$db" < $$f && sqlite3 "$$db" "INSERT INTO schema_migrations (name) VALUES ('$$n')" || exit 1; \
	done

# Applies one down migration, e.g.: make migrate-down file=migrations/000001_create_links_table.down.sql
migrate-down:
	sqlite3 -bail "$(DATABASE_PATH)" < $(file)
	@sqlite3 "$(DATABASE_PATH)" "DELETE FROM schema_migrations WHERE name = '$$(basename $(file) | sed 's/\.down\.sql$$/.up.sql/')'" 2>/dev/null || true

# Creates a new pair of up/down migration files, e.g.:
#   make migrate-create name=create_products_table
migrate-create:
	@n=$$(printf "%06d" $$(( $$(ls migrations/*.up.sql 2>/dev/null | wc -l) + 1 ))); mkdir -p migrations; \
	touch migrations/$${n}_$(name).up.sql migrations/$${n}_$(name).down.sql; echo "created migrations/$${n}_$(name).{up,down}.sql"
