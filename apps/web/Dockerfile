# Production image. Build from the repository root (the lockfile lives there):
#   docker build -f apps/web/Dockerfile -t useshortly-web .
# VITE_* values are read from apps/web/.env at build time (they end up in the browser bundle, so they are not secrets).
FROM node:24-alpine AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /app
# pnpm-workspace.yaml carries allowBuilds: without it pnpm stops to ask which install scripts may run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter web

FROM base AS build
RUN pnpm install --frozen-lockfile --filter web
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN pnpm --filter web build

# apps/web/node_modules holds relative symlinks into the root node_modules, so both keep the workspace layout.
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app/apps/web
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/build ./build
COPY apps/web/package.json ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
