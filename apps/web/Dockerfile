# Production image. Build from apps/web: docker build -t useshortly-web .
# VITE_* values are read from .env at build time (they end up in the browser bundle, so they are not secrets).
FROM node:24-alpine AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /app
# pnpm-workspace.yaml carries allowBuilds: without it pnpm stops to ask which install scripts may run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
