#!/usr/bin/env sh
# Development: API with hot reload (and the MCP server when apps/mcp/.env exists) in Docker.
# Starts clean every time: removes the previous containers, orphans and the dev volumes
# (only the mcp node_modules one; the SQLite files live in ./data and are kept) and drops dangling images.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo ".env not found: run 'cp .env.example .env' and fill it in" >&2; exit 1; }
compose="docker compose -f docker-compose.dev.yml"
if [ -f apps/mcp/.env ]; then compose="$compose --profile mcp"; else echo "apps/mcp/.env not found: starting without the MCP server"; fi

mkdir -p data
make migrate-up DATABASE_PATH=data/useshortly.db
$compose down --volumes --remove-orphans
docker image prune -f
$compose up --build
