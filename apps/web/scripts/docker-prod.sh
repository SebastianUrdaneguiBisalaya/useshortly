#!/usr/bin/env sh
# Builds and runs apps/web in Docker (production) on 127.0.0.1:${HOST_PORT:-3000}; put your reverse proxy in front.
# Replaces the previous container and drops dangling images.
set -eu
# Builds from the repository root: the lockfile and pnpm-workspace.yaml live there.
cd "$(dirname "$0")/../../.."

name=useshortly-web
docker build -f apps/web/Dockerfile -t "$name" .
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --restart unless-stopped -p "127.0.0.1:${HOST_PORT:-3000}:3000" "$name"
docker image prune -f
