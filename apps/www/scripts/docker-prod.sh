#!/usr/bin/env sh
# Builds and runs apps/www in Docker (production) on 127.0.0.1:${HOST_PORT:-3001}; put your reverse proxy in front.
# Replaces the previous container and drops dangling images.
set -eu
cd "$(dirname "$0")/.."

name=useshortly-www
docker build -t "$name" .
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --restart unless-stopped -p "127.0.0.1:${HOST_PORT:-3001}:3001" "$name"
docker image prune -f
