# useshortly

Open source, self-hosted alternative to Bitly: a URL shortener you run on your own infrastructure and fully control.

## Table of contents

- [Description](#description)
- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Start project in development](#start-project-in-development)
  - [Backend](#backend)
  - [Frontend Web](#frontend-web)
  - [MCP](#mcp)
- [Backend reference](#backend-reference)
  - [Environment variables](#environment-variables)
  - [Limits and lifetimes](#limits-and-lifetimes)
  - [Database: local and Turso sync](#database-local-and-turso-sync)
  - [Concurrency and scaling](#concurrency-and-scaling)
  - [GeoIP](#geoip)
  - [Reverse proxy and `TRUST_PROXY`](#reverse-proxy-and-trust_proxy)
  - [MCP access](#mcp-access)
- [Start project in production](#start-project-in-production)
  - [Backend](#backend-1)
  - [Frontend Web](#frontend-web-1)
  - [MCP](#mcp-1)
- [Contributing](#contributing)

## Description

useshortly turns long URLs into short links (`https://go.example.com/aB3xY9z`) that you host yourself. Your
data stays in a SQLite file you own, optionally replicated to Turso Cloud.

What it does:

- **Short links** with random 7-character codes or **custom aliases**.
- **Expiration** by date and/or maximum number of clicks.
- **Click analytics**: time, referrer, country, device.
- **Password-protected links** with a customizable unlock page.
- **QR codes** per link.
- **Custom domains** per organization, verified with a DNS TXT record.
- **Accounts and organizations**: email + password (with email code verification) or Google sign-in, multiple
  members per organization.
- **API keys** (`read` / `write` scopes) and an **MCP server**, so scripts and AI assistants (Claude, Cursor, …)
  can manage links.

A visit to `GET /{code}` answers **302** (not 301), so every click reaches your server and can be counted.

## Stack

| Part | Technology |
| --- | --- |
| **Backend** (`/`, `cmd/api`, `internal`) | Go 1.26 · `gorilla/mux` (router) · SQLite through `tursogo` (optional Turso Cloud sync) · Redis (`go-redis`) · JWT (`golang-jwt`) · argon2id password hashing · Resend (email) · Google ID-token verification · MaxMind GeoIP (`geoip2-golang`) · `go-chi/httprate` (rate limits) · `godotenv` · OpenAPI 3.1 via `swag` · tests with `testify` |
| **Web app** (`apps/web`) | React 19 · React Router 8 (SSR) · Vite · Tailwind CSS 4 · TanStack Query and Table · Zustand · react-hook-form + Zod · Tiptap · Recharts · i18next · Axios + Orval (client generated from the OpenAPI spec) · Biome |
| **MCP server** (`apps/mcp`) | Node.js 24 · TypeScript · Hono · Better Auth (OAuth 2.1, CIMD) · MCP SDK · Kysely · SQLite (Turso / better-sqlite3) · Vitest |
| **Desktop app** (`apps/desktop`) | Electron · TypeScript (early scaffold) |
| **Landing site** (`apps/www`) | Next.js 16 · React 19 |
| **Infrastructure** | Docker / Docker Compose · Redis · plain-SQL migrations applied with the `sqlite3` CLI |

## Repository layout

```
cmd/api/           Backend entry point (wires config, adapters and services)
internal/domain/   Business rules and ports (link, user, org, apikey, analytics, domain, ...)
internal/adapter/  HTTP, SQLite, Redis, JWT, GeoIP, email... implementations of those ports
migrations/        Versioned SQL migrations
apps/web/          Web dashboard
apps/mcp/          MCP server (has its own detailed README)
apps/desktop/      Desktop app (scaffold)
apps/www/          Landing site
```

Each app under `apps/` is installed on its own with `pnpm`; there is no root workspace.

## Start project in development

### Backend

#### Requirements

| Tool | Why |
| --- | --- |
| Go 1.26+ | Builds and runs the API |
| A Redis database | The API refuses to start without it. Use [Upstash](https://upstash.com) (free tier) or a local Redis |
| `sqlite3` CLI and `make` | Apply the SQL migrations (`make migrate-up`) |
| `openssl` | Generates secrets (any random 32+ character string works) |

#### 1. Get a Redis URL

Redis stores one-time email codes, the link lookup cache and the password-attempt counters. Nothing in it needs
to survive a restart.

- **Upstash (recommended):** create a Redis database and copy its TLS URL, which looks like
  `rediss://default:<password>@<endpoint>.upstash.io:6379` (note the double `s`: TLS).
- **Local alternative:** `docker run -d --name useshortly-redis -p 6379:6379 redis:7` and use
  `redis://localhost:6379`.

#### 2. Create your `.env`

From the repository root. The `Makefile` reads `.env`, so create it before running any `make` target.

```sh
cp .env.example .env
```

Edit `.env` and set at least these values (everything else has a working default for development):

```sh
REDIS_URL=<the URL from step 1>
JWT_SECRET=<output of: openssl rand -base64 32>
OTP_SECRET=<another one: openssl rand -base64 32>
```

Leave `RESEND_API_KEY` empty: in development the API **prints emails in its log** instead of sending them, so
the 6-digit sign-up code appears in your terminal. All variables are described in
[Environment variables](#environment-variables).

#### 3. Create the database

```sh
make migrate-up
```

This creates `useshortly.db` in the repository root (`DATABASE_PATH`) and applies every file in `migrations/`.
Each migration runs once and is recorded in the `schema_migrations` table, so the command is safe to repeat; run
it again after pulling new migrations.

#### 4. Run the API

```sh
make run
```

The API listens on `http://localhost:8080`. Check it:

```sh
curl -s localhost:8080/health      # OK
```

Other useful targets: `make test` (unit tests, no database or Redis needed) and `make openapi` (regenerates
`api/openapi/swagger.json`; needs `swag`: `go install github.com/swaggo/swag/v2/cmd/swag@latest`).

#### Alternative: everything in Docker with hot reload

If you prefer not to install Go, one script does it all: it creates the database in `./data`, removes the
previous containers, orphans and dev volumes, drops dangling images, and starts the API with
[air](https://github.com/air-verse/air) (rebuilds on save). It also starts the MCP server if `apps/mcp/.env`
exists. It still needs `make` and the `sqlite3` CLI on the host for the migrations, and a Redis URL that works
from inside a container (an Upstash URL does; `localhost` does not).

```sh
./scripts/deploy.dev.sh
```

Your data in `./data` is kept between runs.

### Frontend Web

Requires Node.js 24 and pnpm 12.15.0 (`npm install -g pnpm@12.15.0`), and the [backend](#backend) running on
port 8080.

```sh
cd apps/web
cp .env.example .env
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The backend has no CORS: in development Vite forwards `/api` to
`VITE_API_PROXY_TARGET` (default `http://localhost:8080`), so leave `VITE_API_URL` empty.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Base URL of the backend. Empty = same origin (development proxy, or a reverse proxy in production). |
| `VITE_API_PROXY_TARGET` | Where Vite forwards `/api` in development. |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client id for "Continue with Google". Same value as the backend `GOOGLE_CLIENT_ID`. Empty hides the button. |

To sign up, use the form: the confirmation code is printed in the **API's terminal log** (see step 2).

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm format`, and `pnpm api:generate` (regenerates the API client
from `api/openapi/swagger.json` after running `make openapi`).

In Docker with hot reload instead: `./apps/web/scripts/docker-dev.sh` (it reaches the API on the host through
`host.docker.internal:8080`; override with `VITE_API_PROXY_TARGET`).

The landing site (`apps/www`) works the same way: `cd apps/www && pnpm install && pnpm dev`
(`http://localhost:3000`), or `./apps/www/scripts/docker-dev.sh`.

### MCP

The MCP server lets AI assistants use your account through OAuth 2.1. It is a separate Node service that needs
the backend running. Full walkthrough, with every step and troubleshooting: [`apps/mcp/README.md`](./apps/mcp/README.md).
In short:

```sh
cd apps/mcp
pnpm install
pnpm keygen          # prints MCP_SIGNING_KEY and AUTH_SECRET (for apps/mcp/.env) and MCP_PUBLIC_KEY (for the root .env)
cp .env.example .env # paste MCP_SIGNING_KEY and AUTH_SECRET
```

Put `MCP_PUBLIC_KEY` in the backend's `.env` and **restart the backend**, then:

```sh
pnpm dev             # http://localhost:4001
curl -s localhost:4001/health
```

## Backend reference

Everything to know before relying on the API. Values come from the code and are the defaults.

### Environment variables

Configuration is read from the environment (a `.env` file is loaded only for local development). The API
**fails to start** with a clear message if a required value is missing or invalid.

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `ENVIRONMENT` | `development` | no | `production` makes `RESEND_API_KEY` mandatory. The production compose file forces it. |
| `PORT` | `8080` | no | HTTP port. |
| `DATABASE_PATH` | `useshortly.db` | no | Local SQLite file. The compose files override it (`/data/useshortly.db`, `/app/data/useshortly.db`). |
| `TURSO_DATABASE_URL` | empty | no | Turso Cloud database URL. Empty = local only. See [Database](#database-local-and-turso-sync). |
| `TURSO_AUTH_TOKEN` | empty | with the URL | Turso token. Mandatory when `TURSO_DATABASE_URL` is set. |
| `SYNC_INTERVAL` | `30s` | no | How often the local file is pulled from / pushed to Turso. Go duration, > 0. |
| `REDIS_URL` | empty | **yes** | e.g. `redis://localhost:6379`. |
| `JWT_SECRET` | empty | **yes** | At least 32 characters. Signs access tokens (and derives the custom-domain verification value). Changing it signs everyone out. |
| `JWT_TTL` | `24h` | no | Lifetime of the access token. |
| `REFRESH_TTL` | `720h` (30 days) | no | Lifetime of the refresh token (the session). |
| `OTP_SECRET` | empty | **yes** | At least 32 characters. Protects the one-time email codes. |
| `APP_URL` | `http://localhost:8080` | no | Public URL short links are served from. Also used in emails and QR codes. With `https://`, session cookies are marked `Secure`. |
| `LINK_CACHE_TTL` | `5m` | no | How long a redirect lookup stays cached in Redis. |
| `RESEND_API_KEY` | empty | **in production** | [Resend](https://resend.com) key. Empty = emails are only logged. |
| `MAIL_FROM` | empty | with `RESEND_API_KEY` | Sender address on a domain verified in Resend. |
| `GOOGLE_CLIENT_ID` | empty | no | Enables Google sign-in. Must be set together with `GOOGLE_CLIENT_SECRET`. |
| `GOOGLE_CLIENT_SECRET` | empty | with the ID | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | `postmessage` | no | Keep `postmessage` for the web app's popup flow. |
| `GEOIP_DB_PATH` | empty | no | Path to a MaxMind `.mmdb` file. Empty = the country of clicks is not recorded. See [GeoIP](#geoip). |
| `TRUST_PROXY` | `false` | no | Read the visitor's IP from `X-Forwarded-For`. Only `true` behind a reverse proxy. See [Reverse proxy](#reverse-proxy-and-trust_proxy). |
| `RATE_LIMIT` | `true` | no | Turns the request limits on. Disable only if something in front already limits. |
| `ABUSE_EMAIL` | empty | no | Shows a "report this link" address on the unlock page. |
| `MCP_PUBLIC_KEY` | empty | no | Ed25519 public key of the MCP server. Empty disables MCP access. See [MCP access](#mcp-access). |

Durations use Go syntax: `30s`, `5m`, `24h`, `720h`.

### Limits and lifetimes

**Rate limits** (HTTP `429` with `Retry-After`; counters are per process):

| Scope | Limit | Applies to |
| --- | --- | --- |
| Per IP | 10 / minute | Register, verify, login, Google sign-in, forgot / reset password |
| Per IP | 30 / minute | Refresh and logout |
| Per IP | 20 / minute | Unlocking password-protected links |
| Per IP | 300 / minute | Public redirects `GET /{code}` |
| Per user, per API key and per MCP user (each has its own budget) | 600 / minute | Every authenticated API call |

**Tokens and codes:**

| What | Lifetime / rule |
| --- | --- |
| Access token (JWT) | `JWT_TTL`, default 24 h. Sent as an httpOnly cookie or `Authorization: Bearer`. |
| Refresh token | `REFRESH_TTL`, default 30 days. Stored hashed; ends on logout and on password reset. |
| Session cookies | `access_token` (`SameSite=Lax`, path `/api/v1`) and `refresh_token` (`SameSite=Strict`, path `/api/v1/auth`). Both httpOnly; `Secure` when `APP_URL` is `https://`. |
| API key | Prefix `usl_` + 32 random bytes, shown **once**. Scope `read` or `write`. Optional expiry (must be in the future). Name up to 100 characters. |
| MCP token | Ed25519 JWT, **at most 5 minutes** (`exp - iat`), issuer `useshortly-mcp`, audience `useshortly-api`. |
| Email code (OTP) | Valid 10 min, 60 s cooldown between requests, 3 attempts. |
| Organization invitation | Valid 7 days. |
| Redirect cache | `LINK_CACHE_TTL`, default 5 min. |

**Content limits:**

| What | Limit |
| --- | --- |
| Long URL | 255 characters |
| Custom alias | 3–15 characters (random codes are 7 base62 characters) |
| Max clicks | must be greater than 0 |
| Link password | 4–64 characters; after 3 free tries each wrong try adds a wait of 30 s, doubling up to 1 h, forgotten after 24 h |
| Account password | 8–128 characters (argon2id: 64 MiB, 3 passes, 2 threads) |
| Names and descriptions (user, organization) | 255 characters |
| Unlock page HTML | 64 KiB |
| Request body | 1 MiB |
| QR size | 64–1024 px (default 256) |
| Statistics range | default 30 days, maximum 366 days |
| Lists (pagination) | default 50, maximum 100 per page |
| Domain name | 253 characters, 63 per label |
| Request timeouts | read 10 s, write 15 s, idle 60 s; graceful shutdown waits up to 10 s |

**Custom domains** are verified with a DNS TXT record on `_useshortly-verify.<your-host>`; the API returns the
exact name and value to create (`POST /orgs/{orgID}/domains`). The domain must also point at your server and
your proxy must forward the original `Host` header, which is how the API knows which domain a request is for.

### Database: local and Turso sync

- **Local only (default):** leave `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` empty. Everything lives in the
  file at `DATABASE_PATH`.
- **Local + Turso Cloud:** set both variables. The local file is still what the app reads and writes; every
  `SYNC_INTERVAL` it pulls remote changes and pushes local ones, and it does a final push on shutdown (10 s).
  Use a Turso database created for this app.
- Migrations are plain SQL in `migrations/`, applied with `make migrate-up`; roll one back with
  `make migrate-down file=migrations/<name>.down.sql`. Create a new pair with `make migrate-create name=<name>`.
- Back up by copying the SQLite file (or the Docker `data` volume) while the app is stopped, or rely on Turso.

### Concurrency and scaling

- The database uses **one connection** (SQLite has a single writer, and it keeps foreign keys on). Requests are
  safe to run concurrently; database work is serialized. This is plenty for a redirect-heavy workload because
  redirects are served from the Redis cache.
- **Run one API instance per database.** Rate-limit counters live in the process memory, so several instances
  would each apply their own limit. (Password-attempt counters and the redirect cache are in Redis and shared.)
- Clicks are recorded in the background through a buffer of **1024**; if it fills up, new clicks are dropped
  (and counted) rather than slowing down the redirect. The buffer is flushed on shutdown.
- Emails are sent in the background and never block or fail the request that triggered them (15 s timeout).
- Deleted organizations are purged in the background (every 30 s, in batches).

### GeoIP

Country analytics are optional and need a MaxMind database that you download yourself (the file is not
distributed with the project):

1. Create a free account at [MaxMind](https://www.maxmind.com/en/geolite2/signup) and download
   **GeoLite2 Country** (`GeoLite2-Country.mmdb`; the City database also works).
2. Put the file somewhere readable and set its path:

   ```sh
   GEOIP_DB_PATH=/path/to/GeoLite2-Country.mmdb
   ```

3. Restart the API. If the path is wrong it fails at startup; if it is empty it logs
   `GEOIP_DB_PATH is not set` and clicks are stored without a country.

Behind a proxy you also need `TRUST_PROXY=true`, otherwise every click is geolocated from the proxy's address.
MaxMind updates the database regularly; replace the file and restart to refresh it.

### Reverse proxy and `TRUST_PROXY`

The API takes the visitor's address from the TCP connection. Behind nginx, Caddy or a load balancer that is the
proxy's address, which breaks per-IP rate limits and the click country. Set `TRUST_PROXY=true` **only when the
API is reachable exclusively through your proxy**: it then trusts the **first** `X-Forwarded-For` entry, and a
visitor who can reach the API directly could forge any address.

Because the first entry is used, make your proxy **overwrite** the header with the real client address (nginx:
`proxy_set_header X-Forwarded-For $remote_addr;`) instead of appending to what the client sent.

### MCP access

`MCP_PUBLIC_KEY` is the Ed25519 public key (PEM, or base64 of the raw 32 bytes) of the MCP server. The API only
**verifies** MCP tokens with it; it can never mint them. Generate the pair with `pnpm keygen` in `apps/mcp`
(or `openssl genpkey -algorithm ED25519 -out mcp-private.pem && openssl pkey -in mcp-private.pem -pubout`).
Empty disables MCP access. MCP tokens are read/write-scoped like API keys and share the 600 / minute budget.

## Start project in production

Self-hosted. The backend runs as a container with a `data` volume holding the SQLite file; no database container
is started.

### Backend

#### What you need

- A server with Docker and Docker Compose, and a DNS name for the short links (for example `go.example.com`).
- A **Redis** database reachable from the server. The compose file does not include one: use
  [Upstash](https://upstash.com) or any managed/self-managed Redis.
- A [Resend](https://resend.com) account with a verified sender domain: in production the API refuses to start
  without `RESEND_API_KEY` and `MAIL_FROM`.
- A reverse proxy with TLS (nginx below).

#### 1. Configure `.env`

```sh
git clone <your-fork-or-this-repo> && cd useshortly
cp .env.example .env
```

Same variables as in [development](#environment-variables), with these differences:

```sh
APP_URL=https://go.example.com          # public https address of the short links
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6379   # your Upstash TLS URL
JWT_SECRET=<openssl rand -base64 32>
OTP_SECRET=<openssl rand -base64 32>
RESEND_API_KEY=<your key>
MAIL_FROM=useshortly <no-reply@example.com>
TRUST_PROXY=true                        # you will put a proxy in front
# Optional: GEOIP_DB_PATH, GOOGLE_*, ABUSE_EMAIL, MCP_PUBLIC_KEY, TURSO_*
```

You do not need to set `ENVIRONMENT`, `PORT` or `DATABASE_PATH`: `docker-compose.yml` sets them to `production`,
`8080` and `/data/useshortly.db`. Never commit `.env`.

#### 2. Deploy

```sh
./scripts/deploy.prod.sh
```

The script, in order: builds the image; applies the pending migrations to the `data` volume from a throwaway
container (the image has no `sqlite3`) and hands the files to the unprivileged user the API runs as; starts
(or replaces) the containers with `docker compose up -d --remove-orphans`; and drops dangling images. It also
starts the MCP server when `apps/mcp/.env` exists. Run it again for every upgrade (`git pull` first).

It deliberately **never removes volumes**: the `data` volume is your SQLite database, and `docker volume prune`
or `docker compose down -v` would delete it.

Check it:

```sh
docker compose logs -f app          # wait for: Http server listening on :8080
curl -s localhost:8080/health       # OK
```

Port 8080 is published on every interface of the host: firewall it so only your proxy reaches it.

#### 3. GeoIP

Download the database as described in [GeoIP](#geoip), then mount it read-only with a
`docker-compose.override.yml` next to `docker-compose.yml` (Compose merges it automatically):

```yaml
services:
  app:
    volumes:
      - ./geoip:/geoip:ro
```

Put `GeoLite2-Country.mmdb` in `./geoip` (readable by everyone: `chmod 644`), set
`GEOIP_DB_PATH=/geoip/GeoLite2-Country.mmdb` in `.env`, and run `./scripts/deploy.prod.sh` again.

#### 4. Reverse proxy (nginx)

Terminate TLS in nginx (for example with certbot) and forward everything to the API. The two `proxy_set_header`
lines for the client address and `Host` matter: see [Reverse proxy](#reverse-proxy-and-trust_proxy) and
[Custom domains](#limits-and-lifetimes).

```nginx
server {
    listen 443 ssl;
    server_name go.example.com;           # APP_URL. Add each custom domain here too (or use a wildcard setup)
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

For each custom domain a user adds, point its DNS at this server and add the domain (with its own certificate)
to nginx.

### Frontend Web

The web app is a Node server (React Router SSR). Its browser calls `/api` on **its own origin**, because the
backend has no CORS, so the proxy sends `/api/` to the backend. The web host and `APP_URL` must be on the **same
site** (for example `app.example.com` and `go.example.com`) so the session cookies work.

```sh
cd apps/web
cp .env.example .env     # leave VITE_API_URL empty; set VITE_GOOGLE_CLIENT_ID if you use Google sign-in
./scripts/docker-prod.sh # builds the image (VITE_* values are baked in from .env) and serves 127.0.0.1:3000
```

The script replaces the previous container and drops dangling images. Without Docker:
`pnpm install --frozen-lockfile && pnpm build && PORT=3000 pnpm start`.

The landing site is the same: `./apps/www/scripts/docker-prod.sh` serves `127.0.0.1:3001` (`HOST_PORT` changes
the port); proxy your main domain to it.

nginx for the web host:

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### MCP

Production needs TLS (OAuth clients reject plain `http`), a public name such as `https://mcp.example.com`, and
`MCP_PUBLIC_KEY` set on the backend. It runs from the same compose file under the `mcp` profile, which
`./scripts/deploy.prod.sh` enables automatically when `apps/mcp/.env` exists. That file needs `MCP_SIGNING_KEY`, `AUTH_SECRET`, `MCP_PUBLIC_URL` (https) and `TRUST_PROXY=true`. Complete
steps, nginx/Caddy examples, key rotation and checks: [`apps/mcp/README.md`](./apps/mcp/README.md#run-it-in-production).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull
request. For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of filing a public
issue.

Useshortly is licensed under the [ISC](./LICENSE).
