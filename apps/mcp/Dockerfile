# Build from the repository root: docker build -f apps/mcp/Dockerfile .
# (the tsconfig of apps/mcp extends the shared tsconfig.base.json at the root).

FROM node:24-bookworm-slim AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /work/apps/mcp
COPY apps/mcp/package.json apps/mcp/pnpm-lock.yaml apps/mcp/pnpm-workspace.yaml ./

# Production dependencies only. better-sqlite3 and the Turso engine ship prebuilt binaries for
# linux x64 and arm64 (glibc), so no compiler is needed: this is why the image is debian-slim.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
COPY tsconfig.base.json /work/tsconfig.base.json
RUN pnpm install --frozen-lockfile
COPY apps/mcp/tsconfig.json apps/mcp/tsconfig.build.json ./
COPY apps/mcp/src ./src
RUN pnpm build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=4001 \
    MCP_DATABASE_PATH=/data/mcp.db
RUN useradd --create-home --uid 10001 app \
    && mkdir /data && chown app /data
WORKDIR /app
COPY --from=deps /work/apps/mcp/node_modules ./node_modules
COPY --from=build /work/apps/mcp/dist ./dist
COPY apps/mcp/package.json ./
USER app
VOLUME /data
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
