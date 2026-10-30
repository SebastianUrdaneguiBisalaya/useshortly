# Build from the repository root: docker build -f apps/mcp/Dockerfile .
# (the tsconfig of apps/mcp extends the shared tsconfig.base.json at the root).

FROM node:24-bookworm-slim AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /app
# The lockfile and pnpm-workspace.yaml (allowBuilds) live at the repository root.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp/package.json ./apps/mcp/

# Production dependencies only. better-sqlite3 and the Turso engine ship prebuilt binaries for
# linux x64 and arm64 (glibc), so no compiler is needed: this is why the image is debian-slim.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter @useshortly/mcp

FROM base AS build
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile --filter @useshortly/mcp
COPY apps/mcp/tsconfig.json apps/mcp/tsconfig.build.json ./apps/mcp/
COPY apps/mcp/src ./apps/mcp/src
RUN pnpm --filter @useshortly/mcp build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=4001 \
    MCP_DATABASE_PATH=/data/mcp.db
RUN useradd --create-home --uid 10001 app \
    && mkdir /data && chown app /data
# apps/mcp/node_modules holds relative symlinks into the root node_modules, so both keep the workspace layout.
WORKDIR /app/apps/mcp
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/mcp/node_modules ./node_modules
COPY --from=build /app/apps/mcp/dist ./dist
COPY apps/mcp/package.json ./
USER app
VOLUME /data
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
