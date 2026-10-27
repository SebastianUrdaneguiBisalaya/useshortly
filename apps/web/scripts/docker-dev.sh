#!/usr/bin/env sh
# Runs apps/web in Docker with hot reload on http://localhost:5173. Always starts from a clean container and
# a fresh node_modules volume, and drops dangling images.
set -eu
cd "$(dirname "$0")/.."

name=useshortly-web-dev
docker rm -f "$name" >/dev/null 2>&1 || true
docker volume rm "$name-node_modules" >/dev/null 2>&1 || true
docker build -f Dockerfile.dev -t "$name" .
docker image prune -f
exec docker run --rm --name "$name" -p 5173:5173 \
  -e VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://host.docker.internal:8080}" \
  -v "$PWD":/app -v "$name-node_modules":/app/node_modules \
  "$name"
