# AGENTS.md — useshortly

Best practices and structure guide for this Go backend. These rules apply to any agent
or developer working in this repository.

## Project

**useshortly** is an open source, self-hosted alternative to Bitly: a URL shortener you run on your
own infrastructure and fully control. Module: `github.com/SebastianUrdaneguiBisalaya/useshortly`.

How it works: `POST /api/links` validates the long URL, generates a unique short code (7 chars
base62 from `crypto/rand`, retried on collision) and stores `code -> URL`. `GET /{code}` looks the
code up (Redis cache first, SQLite on miss), records the click asynchronously and answers
**302** (not 301, so every click reaches the server and can be measured).

Scope: **backend first.** A web dashboard and a desktop app are planned but out of scope until the
API is stable; do not start them.

### MVP features

- Short links with random codes and **custom aliases**
- **Expiration** (date and/or max clicks)
- **Click analytics** (time, referrer, country, device)
- **Accounts** (multi-user with registration, JWT) and **API keys**
- **QR codes** per link
- **Password-protected links**
- **Custom domains** per user (verified via DNS TXT)

### Domain layout

Each concept is a package in `internal/domain`: `link` (core, start here), `user`, `auth`,
`apikey`, `analytics`, `domain`. Order inside a package: `entity.go` -> `errors.go` ->
`repository.go` (port) -> `service.go` -> `service_test.go` (fakes).

### Roadmap (GitHub issues)

The todo list lives in GitHub issues, one small issue per deliverable (a port, an adapter, an
endpoint), labelled by feature (`core`, `alias`, `expiration`, `auth`, `analytics`, `qr`,
`protected`, `domains`, `infra`). Work them roughly in that order; close an issue from its PR
(`Closes #n`).

Create them once with the GitHub CLI (idempotent, skips existing titles):

```sh
gh auth login            # once
./scripts/create-issues.sh
gh issue list --label core
```

Add a new task: `gh issue create --title "..." --label core --body "..."`. Keep issues small; split
any that touches more than one layer (domain, adapter, migration).

## Design principles

1. **Hexagonal architecture (ports & adapters).** The domain (`internal/domain`) defines entities
   and contracts (interfaces/"ports"). Adapters (`internal/adapter`) implement those contracts
   against concrete technology (SQLite/Turso, JWT, HTTP). The domain never imports an infrastructure
   or third-party package.
2. **Dependency-agnostic, except the router.** ORM/query builder, database driver, auth provider,
   etc. are always hidden behind an interface defined in `internal/domain`. If tursogo is swapped for
   sqlc tomorrow, or JWT for sessions, only the corresponding adapter is rewritten; business logic
   is untouched. The HTTP router is the only exception: it is wired directly into the HTTP adapter
   layer without an extra intermediate interface.
3. **Explicit dependency injection (constructor injection).** No DI frameworks. The entry point
   (`cmd/api/main.go`) builds concrete adapters and injects them into domain services through
   constructors that receive interfaces.
4. **The domain knows nothing about HTTP.** Handlers translate HTTP <-> DTOs <-> domain service
   calls. Domain services return typed business errors, not HTTP status codes.
5. **Explicit, typed errors.** Use `errors.New`/`fmt.Errorf` with `%w` for wrapping. Define domain
   errors as sentinel variables (`ErrUserNotFound`, etc.) and map them to HTTP codes only in the
   adapter/http layer.
6. **Contexts everywhere.** Any function crossing an I/O boundary (DB, HTTP, network) must receive
   `context.Context` as its first parameter.
7. **No mutable globals.** Config, connection pools, and clients are created once in `main.go` and
   passed explicitly.
8. **Unit tests for the domain, with hand-written fakes.** No heavy mocking frameworks; a fake
   implementation satisfying the interface is enough. Domain tests must never require a real
   database.
9. **Versioned migrations in plain SQL** (`migrations/` folder), applied with the `sqlite3` CLI
   (`make migrate-up`), to avoid coupling to an ORM.
10. **12-factor config.** Configuration via environment variables, with `.env` only for local
    development (loaded via `godotenv`). Never commit secrets; `.env.example` documents the
    required variables.

## Chosen dependencies

| Need                  | Dependency                       | Notes |
|------------------------|-----------------------------------|-------|
| HTTP router            | `github.com/gorilla/mux`         | The only dependency wired in without an intermediate interface. |
| gRPC (inter-service)   | `google.golang.org/grpc`         | Runs alongside HTTP for service-to-service calls; contract lives in `api/proto`, stubs generated with `make proto` (buf). |
| SQLite driver (Turso)  | `turso.tech/database/tursogo`    | `database/sql` driver, no CGO. Local file, optional sync to Turso Cloud; hidden behind a `Repository` port. |
| Query building         | Plain SQL + repository pattern   | No ORM; makes migrating to sqlc/sqlx later a pure adapter change. |
| Auth (JWT)             | `github.com/golang-jwt/jwt/v5`   | Hidden behind a `TokenService` port. |
| Password hashing       | `golang.org/x/crypto/argon2`     | argon2id behind the `user.PasswordHasher` port. |
| Email (Resend)         | `github.com/resend/resend-go/v4` | Behind the `mailing.Sender` port; sends are asynchronous and best effort (`mailing.Async`), they never block or fail the main flow. |
| Google sign-in         | `google.golang.org/api/idtoken`  | Verifies Google ID tokens behind the `user.GoogleVerifier` port. |
| Config                 | `github.com/joho/godotenv`       | Development only; in production env vars are injected by the platform (container, platform, etc.). |
| IDs                    | `github.com/google/uuid`         | |
| Testing                | stdlib `testing` + `github.com/stretchr/testify` | Assertions and table-driven tests. |

Do not run `go get`/`go mod tidy` unless the user explicitly asks: dependencies are documented in
code and `go.mod` so the user installs them with full control.

### gRPC

The HTTP API and a gRPC server run side by side in `cmd/api/main.go` (`internal/platform/server` and
`internal/platform/grpcserver`), so other microservices can call this backend directly over gRPC
instead of HTTP. The gRPC server currently only exposes health checking and reflection; it has no
generated stubs yet because this environment has no `protoc`/`buf` installed. To finish wiring it:

1. Define/extend the contract in `api/proto` (see `api/proto/user/v1/user.proto` for the example).
2. Install [buf](https://buf.build/docs/installation) and run `make proto` to generate Go stubs
   into `internal/adapter/grpc/gen`.
3. Implement the generated `UserServiceServer` interface in a new
   `internal/adapter/grpc/user_server.go` (same role as the HTTP handler: translates gRPC <-> domain
   service calls, no business logic).
4. Register it in `cmd/api/main.go` via `grpcSrv.Register(func(s *grpc.Server) { userv1.RegisterUserServiceServer(s, grpcUserServer) })`.

Like the router, gRPC is an adapter: the domain layer stays untouched by this.

## Proposed folder structure

```
.
├── cmd/
│   └── api/
│       └── main.go              # Composition root: wires config, adapters and services
├── internal/
│   ├── config/
│   │   └── config.go            # Environment variable loading
│   ├── domain/
│   │   ├── user/
│   │   │   ├── entity.go        # User entity
│   │   │   ├── repository.go    # Port: UserRepository (interface)
│   │   │   ├── errors.go        # Domain errors
│   │   │   └── service.go       # Business logic, depends only on interfaces
│   │   └── auth/
│   │       ├── port.go          # Port: TokenService (interface)
│   │       └── errors.go
│   ├── adapter/
│   │   ├── http/
│   │   │   ├── router/
│   │   │   │   └── router.go    # The only layer that knows about gorilla/mux
│   │   │   ├── handler/
│   │   │   │   └── user_handler.go
│   │   │   ├── middleware/
│   │   │   │   └── auth.go
│   │   │   └── dto/
│   │   │       └── user_dto.go
│   │   ├── repository/
│   │   │   └── sqlite/
│   │   │       └── user_repository.go  # Implements domain/user.Repository on database/sql
│   │   └── auth/
│   │       └── jwt/
│   │           └── jwt_service.go       # Implements domain/auth.TokenService
│   └── platform/
│       ├── database/
│       │   └── sqlite.go        # Local SQLite (tursogo) + optional Turso Cloud sync
│       └── server/
│           └── server.go        # http.Server + graceful shutdown
├── pkg/
│   └── httpresponse/
│       └── response.go          # Standardized JSON response helpers
├── migrations/
│   ├── 000001_create_users_table.up.sql
│   └── 000001_create_users_table.down.sql
├── .env.example
├── Dockerfile                    # Multi-stage build for production
├── Dockerfile.dev                # Hot-reload (air) image for development
├── docker-compose.yml            # Production: app service + data volume (SQLite file)
├── docker-compose.dev.yml        # Development: app with hot reload (air)
└── AGENTS.md
```

## Code conventions

- Package names are lowercase, no underscores or camelCase.
- One package per domain concept (`user`, `auth`, ...), never a generic `models` or `utils`
  package.
- Interfaces are defined in the package that consumes them (the domain), not the package that
  implements them (the adapter). This is what guarantees dependency agnosticism.
- Each adapter implements exactly one port. If an adapter needs more than one responsibility,
  split the port.
- HTTP handlers contain no business logic: they parse input, call the domain service, and map the
  result/error to an HTTP response.
- Every domain service is tested without a real database, injecting a fake that implements the
  repository port.

## Environments

- **Development:** `docker-compose.dev.yml` runs the app with hot reload (`air`, configured in
  `.air.toml`, image `Dockerfile.dev`). The SQLite file is persisted in `./data`.
- **Production:** self-hosted. `docker-compose.yml` runs the app with a `data` volume holding the
  SQLite file. The user chooses the mode via env vars: **local only** (leave `TURSO_*` empty) or
  **local + Turso Cloud** (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`; the app pulls/pushes every
  `SYNC_INTERVAL` and pushes on shutdown). The image is `debian-slim` because `tursogo` loads
  native libraries at runtime. No database container is ever started.
