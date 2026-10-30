# Contributing

Thanks for taking the time to contribute. This file covers the mechanics of making a change: how work is
tracked, branches, commits, checks and pull requests. For how the codebase is organized (hexagonal
architecture, ports and adapters, dependency rules) read [AGENTS.md](./AGENTS.md); for running each app, the
[README](./README.md#start-project-in-development).

## Table of contents

- [How work is tracked](#how-work-is-tracked)
- [Getting set up](#getting-set-up)
- [Branches](#branches)
- [Commits](#commits)
- [Backend changes (Go)](#backend-changes-go)
- [Frontend changes (apps)](#frontend-changes-apps)
- [Database changes](#database-changes)
- [API contract changes](#api-contract-changes)
- [Before opening a pull request](#before-opening-a-pull-request)
- [Opening the pull request](#opening-the-pull-request)
- [Security](#security)
- [Questions](#questions)

## How work is tracked

All work lives in [GitHub issues](https://github.com/SebastianUrdaneguiBisalaya/useshortly/issues), one small
issue per deliverable: a port, an adapter, a migration, an endpoint, a screen.

- **Labels** say which feature an issue belongs to: `core`, `alias`, `expiration`, `auth`, `analytics`, `qr`,
  `protected`, `domains`, `campaigns`, `mcp`, `web`, `infra`. Use `good first issue` / `help wanted` to find a
  starting point.
- **Keep issues small.** If an issue touches more than one layer (domain, adapter, migration, UI), split it.
- **Comment before you start** on an issue so nobody duplicates the work. For anything not already covered by an
  issue, open one first and describe the change; large or architectural changes should be agreed on there
  before any code is written.

```sh
gh issue list --label core
gh issue create --title "feat(link): ..." --label core --body "..."
```

## Getting set up

Requirements: Go (version in [`go.mod`](./go.mod)), the `sqlite3` CLI, `make`, a Redis URL, and for the apps
Node.js 24 with pnpm 12.15.0 (`npm install -g pnpm@12.15.0`).

```sh
git clone https://github.com/SebastianUrdaneguiBisalaya/useshortly.git
cd useshortly
cp .env.example .env      # fill JWT_SECRET, OTP_SECRET, REDIS_URL, ...
make migrate-up           # creates useshortly.db and applies migrations/
make run                  # API on http://localhost:8080

pnpm install              # every app under apps/, one lockfile
pnpm --filter web dev     # or: pnpm dev for every app in parallel
```

Prefer Docker with hot reload? `./scripts/deploy.dev.sh`. The full walkthrough (Redis, Google sign-in, MCP keys)
is in the [README](./README.md#start-project-in-development).

## Branches

Always branch from an up-to-date `main`; never commit to `main` directly.

```
<type>/<short-kebab-description>
```

| Prefix      | For                                         | Example                       |
|-------------|---------------------------------------------|-------------------------------|
| `feat/`     | New behaviour                               | `feat/link-expiration`        |
| `fix/`      | Bug fixes                                   | `fix/qr-download`             |
| `chore/`    | Tooling, dependencies, housekeeping         | `chore/pnpm-workspace`        |
| `docs/`     | Documentation only                          | `docs/mcp-campaign-tools`     |
| `refactor/` | Restructuring with no behaviour change      | `refactor/link-repository`    |

One branch per feature or tightly related group of issues. Keep it rebased on `main` (or merge `main` in) so it
merges without conflicts.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) with a scope:

```
<type>(<scope>): <what the change does, lowercase, imperative, no period>
```

- **Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `chore`, `style`.
- **Scopes** name the layer or area touched: a domain package (`link`, `auth`, `analytics`, `campaigns`,
  `domain`), an adapter (`http`, `sqlite`, `api`), or an app (`web`, `www`, `desktop`, `mcp`, `ui`).
- **One logical change per commit.** A feature that crosses layers is usually several commits, domain first,
  then adapters, then the client:

```
feat(analytics): count stats days, hours and weekdays in a time zone
feat(sqlite): bucket click stats by day, hour and weekday in a time zone
feat(http): tz query parameter on link and campaign stats
feat(web): send the display time zone with stats and export requests
```

Explain the *why* in the commit body when it is not obvious from the subject. Do not add AI co-author trailers.

## Backend changes (Go)

The rules in [AGENTS.md](./AGENTS.md) are not optional; reviews check them. In short:

- **The domain (`internal/domain`) imports nothing from infrastructure** or third-party packages. It defines
  entities and ports (interfaces); adapters in `internal/adapter` implement them.
- **New domain package layout:** `entity.go` → `errors.go` → `repository.go` (port) → `service.go` →
  `service_test.go`.
- **Interfaces live in the consumer** (the domain), and each adapter implements exactly one port.
- **Handlers hold no business logic.** They parse input, call a service and map the result to a response.
  Domain errors are sentinel values (`ErrLinkNotFound`); they are mapped to HTTP status codes only in
  `internal/adapter/http`.
- **`context.Context` first** in every function that crosses an I/O boundary.
- **No mutable globals.** Config, pools and clients are built in `cmd/api/main.go` and injected through
  constructors.
- **Tests:** every domain service is unit tested with hand-written fakes of its ports (stdlib `testing` +
  `testify`, table-driven). Domain tests never touch a real database or Redis.
- **Dependencies:** don't add one without discussing it in the issue first. Infrastructure libraries must sit
  behind a domain port; the only exception is the HTTP router (`gorilla/mux`).
- Format with `gofmt` and keep `go vet ./...` clean.

## Frontend changes (apps)

The apps under `apps/` (`web`, `www`, `desktop`, `mcp`) form one pnpm workspace with a single `biome.json` and
`pnpm-lock.yaml` at the root.

- **Formatting and linting** are Biome only (tabs, organized imports, sorted keys). Run `pnpm format` before
  committing.
- **The web client is generated.** Do not hand-edit `apps/web/src/api`; regenerate it (see
  [API contract changes](#api-contract-changes)).
- **Dependencies** are pinned to exact versions (`saveExact`). Commit the updated `pnpm-lock.yaml` with any
  `package.json` change. If a new package needs an install script, add it to `allowBuilds` in
  `pnpm-workspace.yaml`.
- `apps/web` has no unit test suite; check UI changes by hand in the browser (and in the desktop app if the
  change touches the Electron bridge). Include screenshots in the PR.
- `apps/mcp` uses Vitest (`pnpm --filter @useshortly/mcp test`).

## Database changes

Migrations are versioned, plain SQL files in [`migrations/`](./migrations), applied with the `sqlite3` CLI.

```sh
make migrate-create name=add_link_notes   # creates 0000NN_add_link_notes.{up,down}.sql
make migrate-up                           # applies pending ones, records them in schema_migrations
make migrate-down file=migrations/0000NN_add_link_notes.down.sql
```

- **Never edit a migration that is already on `main`.** Add a new one.
- Every `up` has a `down` that fully reverts it. Test both locally.
- SQLite cannot alter most column definitions; when a table has to be rebuilt, wrap the rebuild in a
  transaction so a failure changes nothing.
- A schema change is its own commit (and ideally its own issue), separate from the repository adapter that uses
  it.

## API contract changes

The OpenAPI spec is generated from the handler annotations, and the web client and the MCP server are built from
it. When you add or change an endpoint:

1. Update the `swag` annotations on the handler and its DTOs.
2. `make openapi` to regenerate `api/openapi/swagger.json` (needs
   `go install github.com/swaggo/swag/v2/cmd/swag@latest`).
3. `pnpm --filter web api:generate` to regenerate the typed client.
4. Commit the spec and the generated code with the change. Prefer additive changes (new optional fields or
   parameters) so existing clients keep working.

## Before opening a pull request

Run what applies to your change:

```sh
make test            # Go unit tests
go vet ./...
pnpm lint            # Biome over apps/
pnpm typecheck
pnpm test            # apps that have tests
```

Also check that:

- The branch is up to date with `main` and contains only commits for this change.
- New environment variables are documented in `.env.example` (and in the README's environment table).
- Docs that the change makes outdated (README, AGENTS.md, an app's README) are updated in the same PR.

## Opening the pull request

- **Title** in Conventional Commit form: `feat(mcp): campaigns in the MCP server`.
- **Body:** a `## Summary` (or `## Why` + `## What`) saying what problem it solves and how, grouped by layer or
  app when it touches several. Call out anything a reviewer should look at closely, breaking changes and manual
  steps (new env vars, migrations to run).
- **Link the issues** with `Closes #n` for each one, so they close on merge.
- **Screenshots or a short recording** for any UI change.
- Keep PRs focused. A PR that does two unrelated things will be asked to split.

Reviews look for correct layering (see [AGENTS.md](./AGENTS.md)), tests for domain logic, and a green local run
of the checks above. PRs are merged with a merge commit, so keep the branch history clean and meaningful.

## Security

- Never commit secrets. `.env` is gitignored; `.env.example` documents every variable with empty or placeholder
  values.
- Do not open a public issue for a vulnerability. Follow [SECURITY.md](./SECURITY.md).

## Questions

Open an issue labelled `question` if something here or in [AGENTS.md](./AGENTS.md) is unclear or out of date.
These files are meant to describe how the project actually works, not how it should work someday.

By contributing you agree that your contributions are licensed under the project's [ISC license](./LICENSE) and
that you follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
