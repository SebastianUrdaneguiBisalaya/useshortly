# Production image. Build from the repository root (the lockfile lives there):
#   docker build -f apps/www/Dockerfile -t useshortly-www .
FROM node:24-alpine AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /app
# pnpm-workspace.yaml carries allowBuilds: without it pnpm stops to ask which install scripts may run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/www/package.json ./apps/www/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter www
COPY tsconfig.base.json ./
COPY apps/www ./apps/www
RUN pnpm --filter www build

# next.config.ts sets output: "standalone" traced from the repository root, so the build ships its own minimal
# server under .next/standalone/apps/www, next to the node_modules it needs.
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/www/.next/standalone ./
COPY --from=build /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=build /app/apps/www/public ./apps/www/public
USER node
EXPOSE 3000
CMD ["node", "apps/www/server.js"]
