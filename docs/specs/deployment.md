# Deployment: Running Obiter Through Dokploy

Status: planned (July 2026). PostgreSQL 16 already runs on the Hetzner VPS under Dokploy. Nothing else is deployable yet — this spec closes that gap for the API (which includes auth) and the web app.

## Verified current state

- **Database**: running on the server (Dokploy). Local dev expects `postgres://obiter:obiter@localhost:5432/obiter` (default in `services/api/src/env.ts`).
- **Web Dockerfile exists** at `apps/web/Dockerfile` (added in the app shell rebuild M3), with a dependency-free SSR host (`apps/web/serve.mjs`) and a repo-root `.dockerignore`. It has not been `docker build`-verified in the dev environment (no Docker there) but is standard Node 22 + corepack pnpm and CI-verifiable; see the Implementation section below.
- **No API Dockerfile and no migration runner** exist yet. `packages/database/migrations/*.sql` are raw SQL files with no tracking table and no apply script — the server schema was applied manually. Both are Redact-track owned and remain a precondition for automated API deploys; a deploy that cannot apply `0005_redaction.sql` repeatably will block the Redact track.
- `apps/web` is a TanStack Start app — it has an SSR server component, so it deploys as a Node service, not a static bundle.
- Auth is better-auth with cookie sessions, which constrains routing (below).

## Target shape

Three Dokploy applications on the existing VPS, plus the existing database:

| App        | Source                    | Runtime | Notes                                                                                        |
| ---------- | ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `api`      | `services/api` Dockerfile | Node 22 | Hono server; serves `/api/*` including all better-auth routes. Runs migrations before start. |
| `web`      | `apps/web` Dockerfile     | Node 22 | TanStack Start SSR server.                                                                   |
| `postgres` | already deployed          | —       | Existing Dokploy service; API connects via internal network `DATABASE_URL`.                  |

**Same-domain routing is a hard requirement.** better-auth uses cookie sessions; serving web and API from different origins forces third-party-cookie workarounds that break quietly. Route one domain through Dokploy's Traefik: `/*` → `web`, `/api/*` → `api`. The web app then calls the API with relative URLs and `credentials: 'include'` just works (this matches the contract's `apiFetch` design).

## Work items and ownership

### Migration runner — owned by the Redact track (first to need it)

`scripts/migrate.ts`: applies `packages/database/migrations/*.sql` in filename order, tracked in a `schema_migrations` table (filename + applied_at), idempotent, refuses to run out of order. Wired as `pnpm migrate`. Used identically for local dev, tests, and as the API container's pre-start step. The Redact agent needs this anyway to apply `0005_redaction.sql` repeatably.

### API Dockerfile — owned by the Redact track

- Node 22 slim base, corepack-enabled pnpm, monorepo build via `pnpm --filter @obiter/api deploy` (or fetch + prune pattern).
- Entrypoint: run migrations, then start the server.
- Persistent volume for the HuggingFace model cache (the Rampart ONNX download from Redact PRD 1) so restarts don't re-download.
- Env (from `services/api/src/env.ts` + better-auth): `DATABASE_URL` (Dokploy internal network), better-auth secret/base-URL, CORS origin, and later `REDACT_MODEL_ID` / `REDACT_MIN_SCORE` / `REDACT_CHUNK_TOKENS`.

### Web Dockerfile + Traefik routing — owned by the shell track (Milestone 3)

- Node 22, builds the TanStack Start output, serves SSR.
- Dokploy domain config: single host, `/api` path rule to the API app with higher priority, everything else to web.
- Env: the public base URL (for better-auth client `baseURL`) — with same-domain routing this is just the site origin.

#### Implementation (Milestone 3)

Artifacts shipped:

- `apps/web/Dockerfile` — multi-stage Node 22 slim build. Corepack-enabled pnpm (pinned via the repo `packageManager` field) installs `@obiter/web` and its workspace deps with `--frozen-lockfile`, then `pnpm --filter @obiter/web build` produces `dist/client` (static assets) and `dist/server/server.js` (the SSR fetch handler). **Build invocation:** `docker build -f apps/web/Dockerfile -t obiter-web .` from the **repo root** — the context must be the root because COPY paths span the workspace. In Dokploy: Build Context = repository root, Dockerfile path = `apps/web/Dockerfile`.
- `apps/web/serve.mjs` — dependency-free production SSR host. TanStack Start's built server module exports a Web Fetch handler (`{ fetch }`) and binds no port itself; `serve.mjs` is a `node:http` server that serves `dist/client` static assets directly and forwards everything else to the SSR handler. Streaming uses Node core (`Readable.fromWeb` + `stream/promises` `pipeline`), so error propagation, client-disconnect cancellation, and backpressure are handled natively — no hand-rolled pump. Multiple `Set-Cookie` headers (better-auth session + related cookies) are preserved as an array via `getSetCookie()`. Runtime config from env:
  - `PORT` — TCP port; invalid values (non-decimal, out of 1–65535) fall back to 3000 with a logged warning.
  - `HOST` — bind address (default 0.0.0.0).
  - `OBITER_WEB_ORIGIN` — trusted public origin used to build the request URL. **Set this in Dokploy** (to the site origin). When set it takes precedence over the forgeable client `Host` header, which matters if the container is reachable without Traefik. With same-domain routing this is just the site origin.
  - `BETTER_AUTH_URL` — consumed by the auth client (same-domain ⇒ site origin).
- `apps/web/serve.test.mjs` — focused unit tests (Node's built-in `node:test` runner, no new dependency) for the pure helpers: `parsePort` (range/format), `resolveBaseUrl` (trusted-origin vs Host), and `applyResponseHeaders` (multiple Set-Cookie preservation, status line).
- `apps/web/package.json` gains a `start` script (`node serve.mjs`) so the serve path is reproducible outside Docker too.
- **Repo-root `.dockerignore`** — Docker consults only the `.dockerignore` at the build-context root, so all exclusions live here (including `**/.env*` so secrets are never baked into layers). `apps/web/.dockerignore` is a comment-only pointer, not protective, to avoid the trap of a nested file that looks effective but isn't.

**Verification status:** `apps/web/serve.mjs` has been exercised against a local `vite build` output — it serves static assets (CSS/JS/PNG with correct content-types, large JS streamed through the Node core pipeline with backpressure) and SSR routes (`/search`, `/sign-in`) return 200; multiple `Set-Cookie` headers survive end-to-end as distinct lines; `PORT=abc` correctly falls back to 3000 with a warning. The `serve.test.mjs` suite (17 tests) is green. `docker build` itself has **not** been run (no Docker in the development environment); the Dockerfile is standard Node 22 + corepack pnpm and is CI-verifiable.

**Same-domain routing (Dokploy/Traefik):** deploy the `api` and `web` apps as two Dokploy applications on the same host. Configure the domain with two Traefik rules: `/api/*` → the `api` application (higher priority), `/*` → the `web` application. The web app then calls the API with relative URLs (`apiFetch` already uses `credentials: 'include'`), so better-auth cookie sessions work without third-party-cookie workarounds. This matches the spec's hard requirement above.

**Known follow-up (not in this milestone):** the Satoshi / JetBrains-Mono typefaces currently load from the Fontshare CDN via a `<link>` in `apps/web/src/routes/__root.tsx`. Self-hosting them belongs with a later deployment/CSP hardening pass (an M2 carry-in) — it should land before any production deploy that cares about visitor-IP confidentiality or a strict CSP.

### Explicitly deferred

- `services/worker` and `services/legal-ingestor` deployment (deploy when they do something).
- Meilisearch container formalisation (search already works against the existing setup; formalise when touched).
- CI-driven deploys; Dokploy's git-push/manual deploy is fine for now.

## What this means for local development

The server database does **not** replace the local loop:

- Agents develop against local Postgres (`infra/docker/compose.yaml`, shell track M1 task) — never against the server DB. An agent running migrations or seeds against the live database is the failure mode this rule exists to prevent.
- Verification ladder: local run → typecheck/tests → **staging deploy on Dokploy** → milestone review. The Dokploy deploy is the integration proof (real domain, real cookies, real DB), not the development environment.
- If a local environment cannot run Docker, the fallback is what the shell agent proposed: build, run typecheck/tests, and hand over exact `docker compose up` / `pnpm dev:api` / `pnpm dev:web` steps labelled unverified.
