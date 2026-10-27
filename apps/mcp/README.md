# useshortly MCP server

Lets AI assistants (Claude Code, Claude, Cursor, MCP Inspector…) work with your useshortly account: list
organizations and links, create and delete links, read click statistics, fetch QR codes and manage custom
domains. Users connect with OAuth 2.1; nobody pastes an API key.

It is a separate service next to the Go API. It does not touch the API's database and never forwards the
token a client sends it: every call to the API is signed anew for the user behind that token.

```
MCP client ──OAuth 2.1 + MCP──▶ apps/mcp (Hono, Better Auth) ──short-lived signed token──▶ useshortly API
                                   │ own SQLite file (mcp_* tables)
                                   └─ sign-in: asks the API to check the credentials
```

## What it exposes

| | |
|---|---|
| `POST /mcp` | The MCP endpoint (protocol 2026-07-28, stateless). GET and DELETE answer 405. |
| `/.well-known/oauth-protected-resource` | Resource metadata (RFC 9728), the first thing a client reads after a 401. |
| `/.well-known/oauth-authorization-server/api/auth` | Authorization server metadata (RFC 8414). |
| `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/jwks` | OAuth endpoints and signing keys. |
| `/sign-in`, `/consent` | The pages users see while authorizing a client. |
| `/health` | Liveness. |

### Tools

Read-only connections get the first group; connections where the user granted write access also get the second.

| Tool | What it does |
|---|---|
| `whoami` | The account the connection acts for and whether it is read-only. |
| `list_organizations` | Organizations of the user, with their ids (call this first). |
| `list_links` | Links of an organization, paged. |
| `get_link_stats` | Clicks per day plus top referrers, countries and devices. |
| `get_link_qr` | The QR code of a link as a PNG image. |
| `list_domains` | Custom domains and, for unverified ones, the DNS record to create. |
| `create_link` | Shorten a URL (alias, expiration, click limit, password, custom domain). |
| `delete_link` | Delete a link (marked destructive, so clients ask first). |
| `add_domain` | Register a custom domain and get its DNS TXT record. |
| `verify_domain` | Check the DNS record and verify the domain. |

Prompts: `link_performance_report` (everyone) and `shorten_url` (write connections).

Not exposed on purpose: creating or deleting organizations or accounts, members and invitations, API keys,
unlock pages and deleting domains.

## Setup

You need the API running and a way to serve this service over **https** (a reverse proxy such as Caddy or
nginx). OAuth clients refuse plain http outside localhost.

### 1. Generate the keys

```sh
cd apps/mcp
pnpm install
pnpm keygen
```

It prints three values:

- `MCP_SIGNING_KEY` and `AUTH_SECRET` go in `apps/mcp/.env`.
- `MCP_PUBLIC_KEY` goes in the **API's** `.env`. The API only holds the public half, so it can check the
  tokens this service signs but can never create them. Restart the API after adding it; without it, MCP
  access to the API is off.

### 2. Configure

Copy `.env.example` to `.env` and fill it in.

| Variable | Default | Notes |
|---|---|---|
| `MCP_SIGNING_KEY` | – | Ed25519 private key (PKCS8 PEM or its base64). Required. |
| `AUTH_SECRET` | – | At least 32 characters. Required. |
| `MCP_PUBLIC_URL` | `http://localhost:4001` | Where clients reach this service. **https in production**, no trailing slash. It is the OAuth issuer and the MCP resource, so changing it invalidates existing tokens. |
| `API_URL` | `http://localhost:8080` | The API, without `/api/v1`. In Docker Compose it is `http://app:8080`. |
| `PORT` | `4001` | |
| `ENVIRONMENT` | `development` | `production` demands an https `MCP_PUBLIC_URL`. |
| `TRUST_PROXY` | `false` | Set `true` behind the reverse proxy so rate limits count each visitor, not the proxy. |
| `MCP_DATABASE_PATH` | `data/mcp.db` | This service's own SQLite file. Migrations run on every start. |
| `MCP_TURSO_DATABASE_URL`, `MCP_TURSO_AUTH_TOKEN` | empty | Both set: also sync that file with Turso Cloud. |
| `MCP_SYNC_INTERVAL_SECONDS` | `30` | Pull/push period when syncing. |
| `GOOGLE_CLIENT_ID` | empty | The same Google OAuth client the API uses; shows "Continue with Google". |
| `TRUSTED_ORIGINS` | empty | Comma separated origins allowed to call Better Auth from a browser. |

### 3. Run it

Docker, next to the API (the `mcp` profile is opt-in, so a plain `docker compose up` still starts only the API):

```sh
docker compose --profile mcp up -d
```

The service reads `apps/mcp/.env`, keeps its database in the `mcp_data` volume and publishes `MCP_PORT`
(default 4001). Development with hot reload: `docker compose -f docker-compose.dev.yml --profile mcp up`.

Without Docker:

```sh
pnpm build && pnpm start      # compiled output
pnpm dev                      # tsx watch
```

### 4. Reverse proxy

Point one hostname (for example `mcp.example.com`) at the service, terminate TLS there, and forward
**every** path, because discovery and OAuth live under `/.well-known/`, `/api/auth/`, `/sign-in`,
`/consent` and `/mcp`. Pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`, and do not buffer
responses (MCP can stream). Then set `MCP_PUBLIC_URL=https://mcp.example.com` and `TRUST_PROXY=true`.

## Connect a client

The URL is always `https://<your host>/mcp`.

- **Claude Code**: `claude mcp add --transport http useshortly https://mcp.example.com/mcp`, then run
  `/mcp` inside Claude Code and choose *Authenticate*. A browser opens on your `/sign-in` page.
- **Claude and other apps with custom connectors**: add a remote MCP server with that URL.
- **MCP Inspector**: `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, that URL.

Check each client's own documentation for the exact steps: they change faster than this file. At sign-in
the user enters their useshortly email and password (or uses Google), then sees what the client asks for
and can untick write access before allowing it.

## Security model

- **No passwords here.** `/sign-in` asks the API to check the credentials and keeps only a mapping
  `mcp_user.user_id → API user`. The session the API starts for that check is revoked right away.
- **No token passthrough.** The access token a client holds is only good for this service. For each tool
  call it signs a fresh EdDSA token (60 seconds, audience `useshortly-api`) for that user and scope. The
  API accepts those tokens for the read-only account views (who am I, my organizations) and for the
  organization routes MCP uses, never to change accounts, organizations, members or API keys. It checks on
  every request that the user still exists: deleting an account cuts MCP access at once.
- **Scopes.** `mcp:read` and `mcp:write`. Write implies read. The user can narrow a request on the
  consent screen, and write tools do not even appear on a read-only connection.
- **Short lives.** Access tokens last 15 minutes, refresh tokens 14 days, the sign-in session 8 hours.
- **Client identity.** Clients identify themselves with a Client ID Metadata Document (the way the MCP
  2026-07-28 spec pins). Dynamic client registration is off.
- **Hardening.** Pages carry a strict CSP and cannot be framed; forms accept only same-origin posts;
  failed sign-ins are rate limited per address and per account; link destinations and referrers shown to
  the model are cut to one line (the full value stays in the structured result) so they cannot pose as
  instructions.

## Known limits

- Only MCP protocol 2026-07-28 is served. Clients that speak only the 2025 versions are rejected.
- Clients that need dynamic client registration cannot connect. Turning it on is a deliberate choice that
  is not made here.
- The API limits `/auth/login` and `/auth/google` strictly per address. Every sign-in through this
  service reaches the API from the service's address, so many users signing in at the same moment can
  hit that limit (HTTP 429, shown to them as "too many attempts"). The service forwards the visitor's
  address in `X-Forwarded-For`, but the API only reads it with `TRUST_PROXY=true`, which is safe only when
  the API is reachable solely through a proxy you control.
- Syncing with Turso Cloud is implemented and tested against Turso's local engine, but not yet against
  the cloud service itself. Try it on a throwaway database first.
- If you change `MCP_SIGNING_KEY`, update `MCP_PUBLIC_KEY` on the API at the same time.

## Development

```sh
pnpm install
pnpm dev          # server with hot reload
pnpm typecheck
pnpm test         # unit and end-to-end tests; the API and the internet are simulated
pnpm build        # compiled JS in dist/
```

Layout: `src/auth` (Better Auth, sign-in delegation), `src/http` (sign-in and consent pages), `src/api`
(the signed API client), `src/mcp` (route, tools, prompts), `src/db` (SQLite and Turso), `src/e2e` (the
full client journey) and `src/test` (the harness the tests share).
