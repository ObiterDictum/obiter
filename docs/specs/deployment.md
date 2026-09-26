# Deployment: Running Obiter Through Dokploy

Status: planned (July 2026). PostgreSQL 16 already runs on the Hetzner VPS under Dokploy. Nothing else is deployable yet — this spec closes that gap for the API (which includes auth) and the web app.

## Verified current state

- **Database**: running on the server (Dokploy). Local dev expects `postgres://obiter:obiter@localhost:5432/obiter` (default in `services/api/src/env.ts`).
- **Web Dockerfile exists** at `apps/web/Dockerfile` (added in the app shell rebuild M3), with a dependency-free SSR host (`apps/web/serve.mjs`) and a repo-root `.dockerignore`. It has been `docker build`-verified locally: a build with `--build-arg OBITER_BUILD_COMMIT=<sha> --build-arg OBITER_BUILD_DIRTY=0` produces an image whose `apps/web/dist/.obiter-build.json` names that commit with `dirty: false`, and the image's `serve.mjs` serves the same marker at `/.well-known/obiter-build` (with `OBITER_BUILD_PROVENANCE=1`). See the Implementation section below.
- **API Dockerfile** exists at `services/api/Dockerfile`, delivered with the Bun runtime work below. Migrations in `packages/database/migrations/*.sql` are applied by `bun run db:migrate` (`services/api/src/migrate.ts`, tracked in `schema_migrations`) and at API startup; the server schema is no longer applied manually.
- `apps/web` is a TanStack Start app — it has an SSR server component, so it deploys as a Node service, not a static bundle.
- Auth is better-auth with cookie sessions, which constrains routing (below).

## Target shape

Three Dokploy applications on the existing VPS, plus the existing database:

| App        | Source                    | Runtime                          | Notes                                                                                        |
| ---------- | ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `api`      | `services/api` Dockerfile | Bun 1.4.2 (Node rollback target) | Hono server; serves `/api/*` including all better-auth routes. Runs migrations before start. |
| `web`      | `apps/web` Dockerfile     | Node 22                          | TanStack Start SSR server.                                                                   |
| `postgres` | already deployed          | —                                | Existing Dokploy service; API connects via internal network `DATABASE_URL`.                  |

**Same-domain routing is a hard requirement.** better-auth uses cookie sessions; serving web and API from different origins forces third-party-cookie workarounds that break quietly. Route one domain through Dokploy's Traefik: `/*` → `web`, `/api/*` → `api`. The web app then calls the API with relative URLs and `credentials: 'include'` just works (this matches the contract's `apiFetch` design).

## Work items and ownership

### Migration runner — owned by the Redact track (first to need it)

`services/api/src/migrate.ts`: applies `packages/database/migrations/*.sql` in filename order, tracked in a `schema_migrations` table (filename + applied_at), idempotent, each file in its own transaction, stops at the first failure naming the file. Wired as `bun run db:migrate --database-url=<url>` (the URL must be passed explicitly — no default — so the wrong database is never migrated by accident). The API runs it at startup behind a Postgres advisory lock and refuses to start when migrations cannot be applied. Used identically for local dev, tests, and as the API container's pre-start step. The Redact agent needs this anyway to apply `0005_redaction.sql` repeatably.

### API Dockerfile — delivered with the Bun runtime work

The image now exists at `services/api/Dockerfile`. The Bun migration section
below is the canonical description of its targets, proxy limits and rollback;
what remains true from the original plan:

- `services/api/src/runtime.ts` runs migrations before the socket binds, so there
  is no separate pre-start step for the container.
- The build stage materialises dependencies with `bun install --frozen-lockfile`
  beside the repo-root `bun.lock`. There is no repo-root `.npmrc`: CPU-only ONNX
  Runtime comes from Bun's dependency trust policy, not an install setting (the
  policy and the GPU opt-in are in the ONNX Runtime note below;
  `services/api/src/rampart-install-config.test.ts` fails any workspace
  Dockerfile stage that installs without `bun.lock` or opts `onnxruntime-node`
  into its install scripts).
- Env (from `services/api/src/env.ts` + better-auth): `DATABASE_URL` (Dokploy
  internal network), better-auth secret/base-URL, CORS origin, and the optional
  detection settings `OBITER_RAMPART_MODEL`, `OBITER_RAMPART_REVISION`,
  `OBITER_RAMPART_CACHE_DIR`, `OBITER_RAMPART_MIN_SCORE` and
  `OBITER_RAMPART_CHUNK_TOKENS`. Detection settings are validated once at API
  startup; defaults pin the shipped model/revision, minimum confidence `0.4` and
  chunk size `400`.
- The API loads the model once at startup rather than on the first redaction
  request. A load failure is logged with its cause and leaves the service
  running — detection degrades per run to `heuristics+supplement`, which the
  review UI already labels — so an unreachable Hugging Face does not take the
  whole API down.
- The model weights are baked into the image at `/opt/obiter/rampart-models`, so
  a fresh container needs no download. Mounting a volume over that path shadows
  the baked weights; warm the volume with `bun run prefetch:rampart` first.

### Web Dockerfile + Traefik routing — owned by the shell track (Milestone 3)

- Node 22, builds the TanStack Start output, serves SSR.
- Dokploy domain config: single host, `/api` path rule to the API app with higher priority, everything else to web.
- Env: the public base URL (for better-auth client `baseURL`) — with same-domain routing this is just the site origin.

#### Implementation (Milestone 3)

Artifacts shipped:

- `apps/web/Dockerfile` — multi-stage build: a `FROM node` build stage (Node hosts third-party install scripts) with the pinned Bun copied in beside it runs `bun install --frozen-lockfile --filter @obiter/web`, then `bun --bun run --filter @obiter/web build` produces `dist/client` (static assets) and `dist/server/server.js` (the SSR fetch handler). The runtime stage is `oven/bun` and serves with `bun serve.mjs`. **Build invocation** from the **repo root** — the context must be the root because COPY paths span the workspace:

  ```sh
  docker build -f apps/web/Dockerfile -t obiter-web \
    --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" \
    --build-arg OBITER_BUILD_DIRTY="$(test -n "$(git status --porcelain)" && echo 1 || echo 0)" \
    .
  ```

  The two build args are the artifact's provenance: `.git` is excluded from the build context, so the build stage cannot read the commit itself and takes it from `OBITER_BUILD_COMMIT` (a git SHA) and `OBITER_BUILD_DIRTY` (`0`/`1`) instead. They are written into `dist/.obiter-build.json` by `apps/web/build-provenance.mjs`, and the runner's `--expect-artifact-commit` refuses any image whose marker does not name the expected commit. Pass the truthful dirty flag: a dirty local build records `dirty: true` and is refused by the harness, which is what distinguishes it from a clean CI checkout. A malformed value fails the build; an omitted one records `null` and the image is served but cannot be measured.

  **External boundary:** Dokploy builds this image from the repository without this repository's CI, so it does not know the commit. Set `OBITER_BUILD_COMMIT` and `OBITER_BUILD_DIRTY` as build args in the Dokploy application (Dokploy's build-args setting, or a deploy hook that exports the commit). Until that is configured, a Dokploy-built image records `commit: null` and cannot satisfy `--expect-artifact-commit`; the CI `docker-web` job is the only invocation in this repository that passes them.

  In Dokploy: Build Context = repository root, Dockerfile path = `apps/web/Dockerfile`.

- `apps/web/serve.mjs` — dependency-free production SSR host. TanStack Start's built server module exports a Web Fetch handler (`{ fetch }`) and binds no port itself; `serve.mjs` is a `node:http` server that serves `dist/client` static assets directly and forwards everything else to the SSR handler. Streaming uses Node core (`Readable.fromWeb` + `stream/promises` `pipeline`), so error propagation, client-disconnect cancellation, and backpressure are handled natively — no hand-rolled pump. Multiple `Set-Cookie` headers (better-auth session + related cookies) are preserved as an array via `getSetCookie()`. Runtime config from env:
  - `PORT` — TCP port; invalid values (non-decimal, out of 1–65535) fall back to 3000 with a logged warning.
  - `HOST` — bind address (default 0.0.0.0).
  - `OBITER_WEB_ORIGIN` — trusted public origin used to build the request URL. **Set this in Dokploy** (to the site origin). When set it takes precedence over the forgeable client `Host` header, which matters if the container is reachable without Traefik. With same-domain routing this is just the site origin.
  - `BETTER_AUTH_URL` — consumed by the auth client (same-domain ⇒ site origin).
- `apps/web/serve.test.mjs` — focused unit tests (Node's built-in `node:test` runner, no new dependency) for the pure helpers: `parsePort` (range/format), `resolveBaseUrl` (trusted-origin vs Host), and `applyResponseHeaders` (multiple Set-Cookie preservation, status line).
- `apps/web/package.json` gains a `start` script (`node serve.mjs`) so the serve path is reproducible outside Docker too.
- **ONNX Runtime — CPU-only installs** — there is no repo-root `.npmrc`.
  `onnxruntime-node`'s postinstall is what fetches the optional CUDA and TensorRT
  execution providers (onnxruntime-linux-x64-gpu, ~343 MB unpacked) on Linux x64,
  and every deployment runs detection on CPU. Bun runs lifecycle scripts only for
  trusted dependencies; `onnxruntime-node` is not in Bun's default-trusted set
  and the workspace does not list it in `trustedDependencies`, so the postinstall
  never runs and the provider payload is never fetched. `bun.lock` is the install
  source of truth: **every dependency-materialising stage must copy the repo-root
  `bun.lock` and install with `bun install --frozen-lockfile`**
  (`apps/web/Dockerfile` and `services/api/Dockerfile` both do). A stage that
  installs without the lockfile, or opts the package in with `bun pm trust
onnxruntime-node` / `ONNXRUNTIME_NODE_INSTALL_CUDA`, fails
  `services/api/src/rampart-install-config.test.ts`. A GPU builder opts in
  explicitly on its own machine; images stay CPU.
- **Repo-root `.dockerignore`** — Docker consults only the `.dockerignore` at the build-context root, so all exclusions live here (including `**/.env*` so secrets are never baked into layers). `apps/web/.dockerignore` is a comment-only pointer, not protective, to avoid the trap of a nested file that looks effective but isn't.

**Verification status:** `apps/web/serve.mjs` has been exercised against a local `vite build` output — it serves static assets (CSS/JS/PNG with correct content-types, large JS streamed through the Node core pipeline with backpressure) and SSR routes (`/search`, `/sign-in`) return 200; multiple `Set-Cookie` headers survive end-to-end as distinct lines; `PORT=abc` correctly falls back to 3000 with a warning. The `serve.test.mjs` suite (17 tests) is green. `docker build` has been run and verified: with the provenance build args the image marker names the built commit, without them it records `null` (served but not measurable), and a malformed commit fails the build.

**Same-domain routing (Dokploy/Traefik):** deploy the `api` and `web` apps as two Dokploy applications on the same host. Configure the domain with two Traefik rules: `/api/*` → the `api` application (higher priority), `/*` → the `web` application. The web app then calls the API with relative URLs (`apiFetch` already uses `credentials: 'include'`), so better-auth cookie sessions work without third-party-cookie workarounds. This matches the spec's hard requirement above.

**Fonts (resolved):** the Satoshi / JetBrains-Mono typefaces are now self-hosted (woff2 vendored in `packages/ui/src/fonts/`, served via `@font-face`) — no Fontshare CDN dependency in web or desktop. See [desktop-release.md](./desktop-release.md) for the packaging and licensing notes.

**Desktop packaging** (installers, the packaged API origin, and the packaged Origin/trust story) is covered in [desktop-release.md](./desktop-release.md).

### API runtime and image — native Bun.serve with a Node rollback

Owned by the security lane (board `P1.40`). Implementation is complete;
production rollout is **not** authorised. The evaluation is
`ObiterDictum/obiter#220` (open, unmerged), with durable evidence at
`obiter-ops d7dd3320fdcee7cfdc94ba123e41a7919ed64ab3`,
`evaluations/2026-09-18-bun-serve-runtime/revision-2`.

**Runtime.** The API is built once by `services/api/src/runtime.ts`
(`createApiRuntime()`) and served by one of two adapters, selected by entry
point rather than an environment flag:

| Entry point                      | Adapter             | Image target                        |
| -------------------------------- | ------------------- | ----------------------------------- |
| `services/api/src/server-bun.ts` | native `Bun.serve`  | default (`services/api/Dockerfile`) |
| `services/api/src/server.ts`     | `@hono/node-server` | `--target runtime-node`             |

- Bun is pinned to **1.4.2** in `.bun-version`, root `package.json`
  `packageManager`, and the `ARG BUN_VERSION` plus the
  `oven/bun:1.4.2-slim` base in both workspace Dockerfiles.
  `services/api/src/runtime-pins.test.ts` fails a change that lets any of those
  drift; a version bump must re-run the Bun-runtime CI job before it merges.
- `Bun.serve` is configured explicitly: `hostname: '0.0.0.0'`,
  `maxRequestBodySize: 64 MiB` (a transport backstop; the app's 48 KiB JSON and
  25 MiB upload limits stay authoritative and produce the contract 413),
  `idleTimeout: 30`, and **`development: false`** so Bun's source-and-stack
  error page cannot render, whatever `NODE_ENV` says.
- `NODE_ENV=production` is set in the image. `readNodeEnv` (`@obiter/config`)
  already refuses an unset or unknown `NODE_ENV`, so a container without it
  stops at boot instead of serving in development mode.
- The image is built from the repo root, one target at a time, with the commit
  recorded on the image so a rollback can be shown to be the same product
  commit:

  ```sh
  docker build -f services/api/Dockerfile -t obiter-api \
    --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .          # Bun (default)
  docker build -f services/api/Dockerfile --target runtime-node -t obiter-api-node \
    --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .          # Node rollback
  ```

  Both targets share the one build stage, so they run identical application
  code. `OBITER_BUILD_COMMIT` becomes the image's
  `org.opencontainers.image.revision` label; unset, the label is empty rather
  than a guessed revision. The build installs the production dependency graph
  on Bun, which does not run `onnxruntime-node`'s postinstall, so ONNX Runtime
  stays CPU-only; the policy and its guard are in
  `services/api/src/rampart-install-config.test.ts`. The Rampart model is
  prefetched into `/opt/obiter/rampart-models` at build time and
  `OBITER_RAMPART_CACHE_DIR` points there; mounting a volume over that path
  shadows the baked weights, so warm the volume with `bun run prefetch:rampart`
  first if you do.

**Startup, health and readiness.** `createApiRuntime()` validates the
environment, applies migrations behind a Postgres advisory lock (and refuses to
start if any fail), builds the app, probes the stored search index without
blocking, and warms the detection model without blocking. `/api/health` is the
liveness/readiness probe; it also reports `runtime: 'bun' | 'node'` so a canary
or an operator can confirm which adapter answered.

**Request limits and proxy prerequisites.** Bun exposes no request-header
deadline, no whole-request deadline and no configurable header-size limit, so
those bounds must be enforced at the reverse proxy. The values live in
[`infra/traefik/entrypoints.yml`](../../infra/traefik/entrypoints.yml) and are
applied to Dokploy's `/etc/dokploy/traefik/traefik.yml`. Dokploy generates that
file at install and never rewrites it, so it is not in this repository: merging
a change here does **not** change Traefik.

| Concern             | Node                                   | Bun 1.4.2                         | Proxy value                   | Where enforced                               |
| ------------------- | -------------------------------------- | --------------------------------- | ----------------------------- | -------------------------------------------- |
| request deadline    | 408 after `headersTimeout`; 300 s body | closed ~12 s, no deadline         | `readTimeout: 300s`           | `entryPoints.*.transport.respondingTimeouts` |
| request header size | 16 KiB, connection destroyed           | 431 at 64 KiB, threshold internal | `http.maxHeaderBytes: 16384`  | `entryPoints.*.http`                         |
| long response       | 300 s would cut a long body            | `idleTimeout` 30 s only           | `writeTimeout: 0s` (disabled) | `entryPoints.*.transport.respondingTimeouts` |
| keep-alive idle     | `keepAliveTimeout` 5 s                 | `idleTimeout` 30 s                | `idleTimeout: 180s`           | app (`idleTimeout`); proxy hold              |

- `readTimeout` is an absolute budget for the request line, headers and body,
  not an inactivity timer. 300 s matches Node's `requestTimeout` and admits the
  25 MiB upload cap at any sustained rate above ~85 KiB/s. A stalled connection
  can hold a socket for up to 300 s; that is the cost of admitting slow uploads
  and is accepted for now.
- `writeTimeout` is disabled deliberately. The prior review (obiter-ops
  `evaluations/2026-09-22-traefik-bun-local-review`) reproduced truncation of any
  response that cannot finish inside a non-zero budget, on Node and Bun alike.
- `maxHeaderBytes` is a Traefik v3.6 entrypoint option. It is absent from
  Dokploy's own configuration schema, so it is not discoverable from Dokploy's
  UI or docs. It bounds the total request line plus headers, not just header
  values: measured against `traefik:v3.6.25` running the shipped fragment, a
  16,329 B header block reaches the origin while ~16,429 B is refused with 431,
  so the effective rejection point is the configured 16 KiB, not that value plus
  a read buffer.

**Validation.** `scripts/api-ingress/ingress.mjs` runs the fragment verbatim in
a disposable Traefik (pinned to `traefik:v3.6.25`, the image Dokploy pulls, with
its digest checked) and puts the real Bun and Node images behind it. It proves
through the proxy: `/api/health` naming the adapter and an authenticated
`/api/me`; a byte-identical DOCX download read slowly; a 25 MiB upload paced at
~640 KiB/s completing in 40 s; a ~10 s download completing; a 64 KiB header
refused with 431; a SIGTERM sent mid-upload that still completes, with the
process draining at the signal and exiting 0; a
Bun → Node → Bun route switch carrying the same session; and a 5 s-timeout
control proxy cut at 5 s, so the shipped values are load-bearing rather than
merely present.

This is validated against the Traefik version Dokploy defaults to and the exact
fragment above, on this host. It does **not** read the running production
server: confirm the deployed `TRAEFIK_VERSION` (`docker image inspect
dokploy-traefik --format '{{.Config.Image}}'`) before applying the fragment, and
re-run the harness after any Traefik or fragment change. TLS, HTTP/2 and HTTP/3
header limits are not covered.

**Shutdown.** Both adapters use `installGracefulShutdown` in
`services/api/src/lifecycle.ts`: SIGTERM/SIGINT stops accepting new work
(`server.close()` + `closeIdleConnections()` on Node, `server.stop(false)` on
Bun), lets in-flight requests finish, closes the Postgres pool, logs
`drained and database pool closed`, and exits 0. A 10 s deadline forces exit 1 if
the drain does not finish; a second signal is ignored. The Bun-runtime CI job
asserts this with a real in-flight download.

**Rollback (Dokploy).** Set the application's **Docker Build Stage** to
`runtime-node` and redeploy; Dokploy passes it as `--target runtime-node`. Bun is
the default target, so clearing the field (or `runtime-bun`) returns to Bun.
Dokploy's "build stage" is its own application setting and is not in this
repository. The application code, migrations and environment are identical, so
no schema or data migration is involved.

Prove the rollback is the same product commit before switching: both images must
carry the same `org.opencontainers.image.revision` label.

```sh
docker image inspect <bun-image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
docker image inspect <node-image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Dokploy does not know the commit it is building, so set `OBITER_BUILD_COMMIT` as
an application build arg (the same external boundary the web image's provenance
has above); without it the label is empty and the comparison proves nothing.
After the switch, `/api/health` reports `runtime: 'node'`. The Node entry point
is exercised by CI and by `scripts/api-ingress/ingress.mjs`, which switches the
route Bun → Node → Bun behind one proxy, so rollback is tested rather than
documented.

**Staged rollout (proposed, not performed).** Canary the Bun image behind the
same Traefik route while the Node image still exists; compare error rate, p95 and
RSS per instance for a fixed window; roll back by redeploying the Node image.

**Owner decision still pending.** The evaluation measured the verification route
slightly slower under Bun: +1.6 ms p50 / +4.5 ms p95 absolute on a ~40–50 ms
route, consistent across rounds at n=120 rather than within run-to-run spread. No
route budget exists, so accepting that regression is an owner decision. It has
**not** been made, and this work does not authorise production rollout.

### Explicitly deferred

- `services/worker` and `services/legal-ingestor` deployment (deploy when they do something).
- Meilisearch container formalisation (search already works against the existing setup; formalise when touched).
- CI-driven deploys; Dokploy's git-push/manual deploy is fine for now.

## What this means for local development

The server database does **not** replace the local loop:

- Agents develop against local Postgres (`infra/docker/compose.yaml`, shell track M1 task) — never against the server DB. An agent running migrations or seeds against the live database is the failure mode this rule exists to prevent.
- Verification ladder: local run → typecheck/tests → **staging deploy on Dokploy** → milestone review. The Dokploy deploy is the integration proof (real domain, real cookies, real DB), not the development environment.
- If a local environment cannot run Docker, the fallback is what the shell agent proposed: build, run typecheck/tests, and hand over exact `docker compose up` / `bun run dev:api` / `bun run dev:web` steps labelled unverified.
