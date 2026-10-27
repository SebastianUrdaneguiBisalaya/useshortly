# Production image. Build from apps/www: docker build -t useshortly-www .
FROM node:24-alpine AS base
# The exact pnpm version the lockfile was made with.
RUN npm install -g pnpm@12.15.0
WORKDIR /app
# pnpm-workspace.yaml carries allowBuilds: without it pnpm stops to ask which install scripts may run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# next.config.ts sets output: "standalone", so the build ships its own minimal server.
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
