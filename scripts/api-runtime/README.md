# API runtime integration harness

Starts the **real** API entry points and checks production behaviour over HTTP.
It is not a benchmark and it asserts no timings; it exists because a green
Vitest run under Node says nothing about the server that ships.

- `services/api/src/server-bun.ts` — native `Bun.serve` (the new entry point).
- `services/api/src/server.ts` — `@hono/node-server` (the rollback path).

Both are built from the same `createApiRuntime()` in
`services/api/src/runtime.ts`, so the checks prove adapter behaviour, not a
second implementation.

## Run

```sh
# both adapters against this task's database
node scripts/api-runtime/runtime-integration.mjs \
  --runtime both \
  --database-url postgres://obiter:obiter@localhost:5432/obiter_api_runtime

# one adapter
node scripts/api-runtime/runtime-integration.mjs --runtime bun --database-url <url>
```

Flags: `--runtime node|bun|both`, `--database-url <url>`,
`--allow-database <name>` (override the owned set, never the protection of a
shared or development database), `--bun-bin <path>`,
`--rampart-cache-dir <dir>`, `--json-out <file>`, `--keep`, `--verbose`.

Exit codes: `0` every check passed on every requested runtime; `1` a check
failed or the two runtimes disagree where they must not; `2` a refusal or setup
failure (bad database, no Bun, no database URL).

## Proving the target is the one used

`database-target.test.mjs` is the fail-first regression: a portless URL plus a
conflicting ambient `PGPORT` must resolve to one explicit port for the real pg
driver and the psql environment alike. For the process-level proof, run

```sh
node scripts/api-runtime/database-target-proof.mjs
```

It starts two controlled loopback listeners, sets ambient `PG*` variables at
the wrong one, and shows the real psql fixtures path and the real Node API child
dial the validated listener only. It touches no Postgres.

## Prerequisites

- Postgres reachable at the URL, with `packages/database/migrations` applied.
- The pinned Bun (`../.bun-version`) on `PATH`, or `--bun-bin`.
- `python3` with `python-docx` for the synthetic DOCX fixtures
  (`scripts/load/make-upload-fixtures.py`). Install with
  `python3 -m pip install python-docx` (CI adds `--break-system-packages`, since
  Ubuntu 24.04 marks the system Python externally managed).
- Network access on a cold model cache: the harness prefetches the Rampart
  model with the product's own `scripts/prefetch-rampart-model.ts` into a
  task-owned cache directory before starting either server, because the API
  only loads a warm cache and does not fetch.

## Safety

- **Database guard.** The API applies migrations to whatever `DATABASE_URL`
  names at boot, so the target is resolved and refused before any connection,
  migration, port allocation or child process. Only `obiter_test`,
  `obiter_api_runtime[_test]`, `obiter_api_ingress[_test]` and
  `obiter_lane_<name>_test` are accepted on loopback; a lane's development
  database (`obiter_lane_security`), the shared `obiter` and `obiter_corpus`,
  the `postgres`/`template*` cluster databases, non-loopback hosts, bracketed
  IPv6 literals (`[::1]` is dialable by neither pg nor psql), percent-encoded
  names and any query parameter at all are refused. The guard returns one
  canonical target naming `host`, `port`, `database`, `user` and `password`
  explicitly; that URL is the one handed to the API, the psql fixtures and the
  corpus boots, and `childEnvironment` pins the same `PG*` values while any
  inherited `PG*` the guard did not set is removed, so an ambient `PGHOST`,
  `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGSERVICE`, `PGPASSFILE` or `PGSSLMODE`
  cannot move a connection. `--database-url` is required; the harness never
  falls back to a lane `.env` or a default database.
- **Database URL semantics.** `--database-url` must be a `postgres://` or
  `postgresql://` URL whose host is `localhost` or `127.0.0.1`, whose path is a
  plain `[A-Za-z0-9_]+` database name, and which names both a user and a
  password; the port is optional and defaults to 5432. Credentials are re-encoded
  into the canonical URL. User and password are required rather than inherited
  because pg would fall back to `PGUSER`/`PGPASSWORD` while psql could also read
  `PGPASSFILE` or `~/.pgpass`, so the two could authenticate as different
  principals. Any query parameter (including `sslmode`) is refused because it
  reaches pg and psql differently.
- **`--allow-database` is intent, not proof.** The override admits a
  deliberate non-owned database when its name matches the URL exactly. An exact
  match does not prove the database is disposable, and it cannot redirect the
  resolved name or override protection for a known shared, cluster or lane
  development database. Treat it as the escape hatch it is: a stale or typo'd
  name can still point at valuable local data.
- **Ports.** Each server gets an OS-allocated ephemeral port. The shared
  `3000`/`8787` and the lane ports `3001-3004`/`8788-8791` are refused.
- **Corpus variables.** The corpus-mode boots point `CORPUS_DATABASE_URL` and
  `CORPUS_WRITE_DATABASE_URL` at the same task-owned database, so a writer
  capability, when asserted, can only land on this task's data.
- **Fixtures.** Two synthetic tenants, one session each and one matter each,
  tagged with a per-run tag. Nothing is deleted: audit rows are history and the
  harness never removes them, and storage lives under a temporary directory
  that is removed at the end.
- **No email.** No sign-up, verification, magic-link or reset flow is invoked;
  `OBITER_RESEND_API_KEY` is a placeholder that never reaches Resend.

## What it checks

`health and authentication` — the `/api/health` `runtime` field names the
adapter; bearer, signed `__Secure-better-auth.session_token` cookie, tampered
and empty cookie, anonymous `/api/me` error envelope with a request id, unknown
route, and that no session token reaches the logs.

`tenant isolation` — cross-tenant matter read/list/document, an absent matter,
anonymous upload, upload into another tenant's matter, and proof the other
tenant can still read its own matter.

`request limits` — a 24 MiB multipart body passes the size gate (the cap
boundary is where the code says it is), 48 KiB JSON and 27 MiB multipart answer
413, and an empty multipart boundary or a truncated multipart body answers 400
`validation_failed` without writing a document row.

`database` — six concurrent creates all commit and Postgres sees all six; a
rejected write commits nothing; a failed upload leaves no document row.

`upload, extraction and streaming` — a real DOCX reaches `ready`, its audit
rows are written, download is byte-identical, a slow reader receives the whole
body, and a mid-download disconnect does not kill the server.

`keep-alive` — 12 authenticated requests reuse at most two sockets.

`verification` — a run executes and its findings are readable.

`search routes` — `/api/search/readiness` answers 200 with no database or
credential detail, and an anonymous stored-only `POST /api/search/fetch`
answers the contract: the fetch envelope, or the documented 503
`search_unavailable` when the engine is unreachable (the harness holds no real
search key, and CI's Bun job runs no engine). The observed status is compared
across the two runtimes.

`corpus modes` — the main run asserts the compatibility mode (no corpus
variables: colocated, writable). Two extra boots per adapter assert an explicit
read-only corpus (`colocated:false, readOnly:true`) and a dedicated writer
(`colocated:false, readOnly:false`), each serving a proved session, and one
boot asserts that a corpus writer without a reader refuses to start. The corpus
URLs always name this task's own database, so no boot touches a shared corpus;
pool routing and the no-fallback rules are proven by the unit suites
(`database-pools`, `env-corpus`, `proxy-routes`).

`native inference` — a redaction run reports `model+supplement`, so detection
exercised the ONNX model rather than the heuristics fallback.

`graceful shutdown` — an in-flight download completes through SIGTERM, the
process exits 0, the drain log reports the pool closed, and the port is
released.

## Malformed multipart

An empty multipart boundary, an absent boundary parameter and a truncated
multipart body are client errors. The parse boundary in
`services/api/src/limited-request-body.ts` (`readLimitedFormData`) returns the
contract **400** `validation_failed` envelope, scoped to the `formData()` call
alone so storage and handler failures keep their own responses. The harness
asserts that status and envelope, that no document row is written, that no
parser detail or request byte is echoed, and that the server answers a later
valid request on both Node and Bun. This closes the pre-existing `P1.41` defect
recorded here when both shapes answered 500 on both runtimes.
