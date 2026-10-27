#!/usr/bin/env sh
# Production: applies the pending migrations, then builds and starts the API (and the MCP server when
# apps/mcp/.env exists). Replaces the running containers, removes orphans and drops dangling images.
# It never removes volumes: `data` holds your SQLite database.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo ".env not found: run 'cp .env.example .env' and fill it in" >&2; exit 1; }
compose="docker compose"
if [ -f apps/mcp/.env ]; then compose="$compose --profile mcp"; else echo "apps/mcp/.env not found: starting without the MCP server"; fi

$compose build
# The image has no sqlite3, so apply the migrations from a throwaway root container that mounts the same
# `data` volume, then hand the files to the unprivileged user the API runs as (uid 10001).
$compose run --rm --no-deps --user root --entrypoint sh -v "$PWD":/src app -c \
  'apt-get update -qq && apt-get install -y -qq make sqlite3 >/dev/null && cd /src && make migrate-up DATABASE_PATH=/data/useshortly.db && chown -R 10001 /data'
$compose up -d --remove-orphans
docker image prune -f
