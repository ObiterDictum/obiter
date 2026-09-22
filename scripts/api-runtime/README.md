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
`--allow-database <name>` (override the guard), `--bun-bin <path>`,
`--rampart-cache-dir <dir>`, `--json-out <file>`, `--keep`, `--verbose`.

Exit codes: `0` every check passed on every requested runtime; `1` a check
failed or the two runtimes disagree where they must not; `2` a refusal or setup
failure (bad database, no Bun, no database URL).

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

- **Database guard.** Fixtures are written only to `obiter_test`,
  `obiter_api_runtime` or `obiter_lane_*` databases on loopback. The shared
  product database (`obiter`) matches none of those and is refused before any
  write. `--allow-database` is the explicit override.
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
413, and malformed/truncated multipart do not take the server down.

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

## Known pre-existing defect

An empty multipart boundary and a truncated multipart body both answer **500**
on Node and Bun. That is a defect in the upload boundary, tracked separately as
board `P1.41`, not a runtime-migration regression. The harness asserts the
server survives both and that the two runtimes agree; it does not pin a status
the migration is not fixing.
