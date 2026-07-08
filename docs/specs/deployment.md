# Deployment: Running Obiter Through Dokploy

Status: planned (July 2026). PostgreSQL 16 already runs on the Hetzner VPS under Dokploy. Nothing else is deployable yet — this spec closes that gap for the API (which includes auth) and the web app.

## Verified current state

- **Database**: running on the server (Dokploy). Local dev expects `postgres://obiter:obiter@localhost:5432/obiter` (default in `services/api/src/env.ts`).
- **No Dockerfiles** exist anywhere in the repo.
- **No migration runner** exists. `packages/database/migrations/*.sql` are raw SQL files with no tracking table and no apply script — the server schema was applied manually. This must be fixed before automated deploys; a deploy that cannot apply `0005_redaction.sql` repeatably will block the Redact track.
- `apps/web` is a TanStack Start app — it has an SSR server component, so it deploys as a Node service, not a static bundle.
- Auth is better-auth with cookie sessions, which constrains routing (below).

## Target shape

Three Dokploy applications on the existing VPS, plus the existing database:

| App | Source | Runtime | Notes |
|---|---|---|---|
| `api` | `services/api` Dockerfile | Node 22 | Hono server; serves `/api/*` including all better-auth routes. Runs migrations before start. |
| `web` | `apps/web` Dockerfile | Node 22 | TanStack Start SSR server. |
| `postgres` | already deployed | — | Existing Dokploy service; API connects via internal network `DATABASE_URL`. |

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

### Explicitly deferred

- `services/worker` and `services/legal-ingestor` deployment (deploy when they do something).
- Meilisearch container formalisation (search already works against the existing setup; formalise when touched).
- CI-driven deploys; Dokploy's git-push/manual deploy is fine for now.

## What this means for local development

The server database does **not** replace the local loop:

- Agents develop against local Postgres (`infra/docker/compose.yaml`, shell track M1 task) — never against the server DB. An agent running migrations or seeds against the live database is the failure mode this rule exists to prevent.
- Verification ladder: local run → typecheck/tests → **staging deploy on Dokploy** → milestone review. The Dokploy deploy is the integration proof (real domain, real cookies, real DB), not the development environment.
- If a local environment cannot run Docker, the fallback is what the shell agent proposed: build, run typecheck/tests, and hand over exact `docker compose up` / `pnpm dev:api` / `pnpm dev:web` steps labelled unverified.
