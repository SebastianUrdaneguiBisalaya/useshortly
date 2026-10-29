#!/usr/bin/env sh
# Runs apps/www in Docker with hot reload on http://localhost:3000. Always starts from a clean container and
# a fresh node_modules volume, and drops dangling images.
set -eu
cd "$(dirname "$0")/.."

name=useshortly-www-dev
docker rm -f "$name" >/dev/null 2>&1 || true
docker volume rm "$name-node_modules" >/dev/null 2>&1 || true
docker build -f Dockerfile.dev -t "$name" .
docker image prune -f
exec docker run --rm --name "$name" -p 3000:3000 \
  -v "$PWD":/app -v "$name-node_modules":/app/node_modules \
  "$name"
