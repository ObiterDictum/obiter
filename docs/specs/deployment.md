# Deployment

Status: live (November 2026). Production runs on one Hetzner host in the EU,
behind Cloudflare, deployed with Kamal. This spec records the shape operators
must keep, the release flow and what must never be exposed. Host addresses,
credentials and the Kamal configuration itself are not in this repository.

## Architecture

```text
browser ──HTTPS──▶ Cloudflare ──HTTPS (origin certificate)──▶ kamal-proxy
                                                                │
                                         /api/*  ◀──────────────┤──────────────▶  /*
                                           │                                     │
                                          api                                   web
                                           │
                              ┌────────────┴────────────┐
                          PostgreSQL               Meilisearch
                       (private container)      (private container)
```

| Component   | Runs as                       | Reachable from                    | Notes                                                                                      |
| ----------- | ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Cloudflare  | Managed edge                  | The internet                      | Terminates public TLS for `app.obiter.si` and proxies to the origin.                       |
| kamal-proxy | Container on the host         | Cloudflare only                   | Holds the Cloudflare origin certificate; routes `/api` to `api`, everything else to `web`. |
| `web`       | Container, `apps/web` image   | kamal-proxy only                  | TanStack Start SSR served by `apps/web/serve.mjs`.                                         |
| `api`       | Container, the API image      | kamal-proxy only                  | Serves `/api/*`, including every auth route. Applies migrations at startup.                |
| PostgreSQL  | Private container (accessory) | `api` on the private network only | PostgreSQL 16. Never published on a host port.                                             |
| Meilisearch | Private container (accessory) | `api` on the private network only | Search index. Never published on a host port.                                              |
| Backups     | Nightly job on the host       | Writes out to object storage      | Encrypted before upload; the bucket is in the EU.                                          |
| Desktop app | Installer on users' machines  | Calls `https://app.obiter.si/api` | Published as a GitHub Release; not served by the host.                                     |

Everything, including backups, stays in the EU. That is the data-residency
commitment in [data-and-compliance.md](../data-and-compliance.md), not a
hosting preference.

## Same origin is a hard requirement

The web app and the API share one origin, `https://app.obiter.si`: the web app
at `/` and the API at `/api`. Auth is better-auth with cookie sessions. On one
origin the session cookie is first-party, the web app calls the API with
relative URLs and `apiFetch`'s `credentials: 'include'` works with no
third-party-cookie workaround. Serving the API from another host breaks sign-in
quietly in browsers that block third-party cookies.

- kamal-proxy routes by path on the one host: `/api` to `api`, everything else
  to `web`. The `/api` route must win over the catch-all.
- Session cookies stay host-only on `app.obiter.si`. Do not widen them to
  `obiter.si` with a cookie domain or cross-subdomain cookies: anything else
  served under `obiter.si` would then receive them.
- The public origin the web app and auth use (`OBITER_WEB_ORIGIN`,
  `BETTER_AUTH_URL`) is `https://app.obiter.si`. `serve.mjs` builds request URLs
  from `OBITER_WEB_ORIGIN` rather than the client's `Host` header.
- The desktop app does not use cookies. It signs in with bearer sessions against
  the same API origin; see [desktop-release.md](./desktop-release.md).

## TLS and Cloudflare

- Cloudflare terminates the public certificate. Between Cloudflare and the
  origin, kamal-proxy presents a Cloudflare origin certificate, and Cloudflare's
  SSL mode must validate it (Full (strict)). Flexible mode, which sends plain
  HTTP to the origin, is not allowed.
- The origin certificate is trusted only by Cloudflare, so the origin answers
  browsers correctly only through Cloudflare. That is intended: the origin
  should accept web traffic from Cloudflare and nothing else.
- Cloudflare closes a request whose origin has not started responding within
  its proxy read timeout (100 s by default). The API's long operations must
  start their response or run as background work within that window.

## Images

### Web

`apps/web/Dockerfile` builds from the repository root, because its `COPY`
paths span the workspace and Docker reads only the root `.dockerignore` (which
excludes `**/.env*`, so secrets never reach a layer). A `node` build stage with
the pinned Bun runs `bun install --frozen-lockfile --filter @obiter/web` and
the web build; the runtime stage is `oven/bun` and runs `bun serve.mjs`.

- The build stage starts from `node` because third-party packages run Node
  lifecycle scripts during install, such as esbuild's `node install.js`. Bun is
  copied in from the `oven/bun` image.
- `COPY --from` cannot expand a build argument, so the `oven/bun` tag in that
  line repeats the version. Keep it, `BUN_VERSION` and `.bun-version` in step.
- No secrets and no API origin are baked in. The web app calls the API with
  relative URLs on the same origin, and all runtime configuration comes from
  the environment.
- The runtime stage keeps `bun.lock` at the image root because
  `packages/config/src/local-env.mjs` walks up to it to find the workspace root.
- The image builds only the web app and the workspace packages it imports. It
  does not build the API or run migrations.

```sh
docker build -f apps/web/Dockerfile -t obiter-web \
  --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" \
  --build-arg OBITER_BUILD_DIRTY="$(test -n "$(git status --porcelain)" && echo 1 || echo 0)" \
  .
```

`.git` is not in the build context, so the commit comes from the two build
arguments. `apps/web/build-provenance.mjs` writes them to
`dist/.obiter-build.json`; a malformed value fails the build and an omitted one
records `null`. The Kamal build must pass both, or the deployed image cannot be
matched to a commit. This repository's CI `docker-web` job builds the image on
every push with both arguments set, but it does not push or deploy it.

`vite build` emits `dist/server/server.js`, a Web Fetch handler that does not
bind a port, so `serve.mjs` is the host: a dependency-free `node:http` server
that runs under Bun. It reads:

- `PORT` (default 3000; an invalid value falls back with a warning) and `HOST`
  (default `0.0.0.0`).
- `OBITER_WEB_ORIGIN`: the trusted public origin, `https://app.obiter.si`.
- `BETTER_AUTH_URL`: the same origin.
- `OBITER_BUILD_PROVENANCE`: `1` exposes the build marker at
  `GET /.well-known/obiter-build`. Leave it unset in production.

It serves `dist/client` assets directly, forwards everything else to the SSR
handler, keeps multiple `Set-Cookie` headers distinct and marks SSR output
`private, no-store`. `apps/web/serve.test.mjs` covers its helpers.

`GET /.well-known/obiter-version` is routed whenever the marker names a commit
and answers `{"build":"<commit>"}` with `Cache-Control: no-store`. It feeds the
new-version prompt below.

### API

The API image is built from the API's own source, not from this repository. It
has two targets that run the same application code: native `Bun.serve` (the
default) and a Node rollback target. Both carry the commit as the
`org.opencontainers.image.revision` label.

- At startup the API validates its environment, applies database migrations
  behind a PostgreSQL advisory lock and refuses to start if any fail. There is
  no separate migration step in the deploy.
- `/api/health` is the liveness and readiness probe, and the deploy's health
  check should use it. It reports `runtime: 'bun' | 'node'`, so an operator can
  confirm which target answered.
- SIGTERM drains in-flight requests and closes the database pool before exit,
  so kamal-proxy's zero-downtime switch does not cut requests.
- Detection runs on CPU. The model weights are baked into the image, so a new
  container needs no download.
- Rollback to the Node target is a redeploy of that image. Before switching,
  confirm both images carry the same revision label.

### Request limits at the proxy

`Bun.serve` has no request-header deadline, no whole-request deadline and no
configurable header-size limit, so those bounds belong at the proxy. Whatever
kamal-proxy and Cloudflare are configured with must still meet these:

| Concern             | Requirement                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| Request deadline    | About 300 s, enough for a 25 MiB upload at roughly 85 KiB/s.           |
| Request body size   | At least the 25 MiB upload cap; the API's own 413 stays authoritative. |
| Request header size | Bounded near 16 KiB.                                                   |
| Response duration   | No write timeout that would truncate a slow download.                  |

The earlier validation of these bounds was against the previous proxy and does
not carry over. Re-validate after any proxy or Cloudflare change.

## Release flow

- `dev` is the integration branch. Every change lands on `dev` through a
  reviewed PR, with CI green.
- `main` is the release branch. Promoting `dev` to `main` is what cuts a
  release, and production is deployed from `main` with Kamal. Nothing is
  deployed from `dev` or from a feature branch.
- Deploys are rolling: kamal-proxy starts the new container, waits for its
  health check and only then moves traffic. A container that fails its health
  check never receives traffic.
- Database migrations are forward-only and run when the new API container
  starts, so a release that adds one must stay compatible with the previous
  release's code for the length of the switch.
- The desktop app ships separately. `.github/workflows/desktop-release.yml`
  builds the Windows installer on every push to `main` and publishes a GitHub
  Release only when the version in `apps/desktop/package.json` has no
  `desktop-v<version>` release yet. A push to `main` without a version bump
  publishes nothing. See [desktop-release.md](./desktop-release.md).

## Backups

Backups run nightly, are encrypted before they leave the host and go to object
storage in the EU. The encryption key must be held apart from the bucket, so
the bucket alone exposes nothing. A backup that has never been restored is not
evidence: restores must be rehearsed against a throwaway database, never the
live one.

## What operators must never expose

- PostgreSQL or Meilisearch on a public or host port. They are reachable only
  from `api` on the private network.
- The `web` or `api` container ports directly. All traffic enters through
  Cloudflare and kamal-proxy.
- The origin's address. Public DNS for `app.obiter.si` stays proxied through
  Cloudflare; a DNS-only record publishes the origin.
- Any credential: the database password, the Meilisearch master key, the auth
  secret, the origin certificate's private key, the backup encryption key,
  object-storage keys, registry credentials or the deploy SSH key. They live in
  the operators' secret store and reach the host only at deploy time. None is
  committed to any repository, written into an image or pasted into an issue,
  PR or log.
- Backups unencrypted, or the backup key beside the backups.
- The build marker (`OBITER_BUILD_PROVENANCE=1`) or any debug mode in
  production.
- Production data to development. Agents and contributors work against local
  databases; nobody runs migrations, seeds or tests against production.

## New-version prompt (web)

After a deploy, open tabs keep running the bundle they loaded. The production
build bakes the commit its marker records into the client as
`__OBITER_BUILD_COMMIT__` (`apps/web/vite.config.ts`, from `buildIdentity` in
`build-provenance.mjs`), and `serve.mjs` serves the running commit at
`/.well-known/obiter-version`. The shell (`packages/app-shell/src/build-version.ts`)
asks that route every 5 minutes while the tab is visible and whenever the
window regains focus. When the served commit differs from the one the page
loaded, it stops polling and shows a compact update icon in the top bar,
labelled "Update available. Reload to update". It never reloads by itself,
because a person may be editing.

- A failed request, an error status or an unreadable body is silent: the next
  poll tries again.
- The dev server defines the commit as `null`, so a dev tab never polls.
- An image built without `OBITER_BUILD_COMMIT` has no commit, serves no version
  route and never prompts. The production image build passes it.
- The polling hook uses `useEffect` because it syncs with timers and the window
  focus event, which RULES.md allows.

## Local development

Production does not replace the local loop. Develop against local PostgreSQL
and Meilisearch, then run typecheck and tests. The verification ladder is local
run, then typecheck and tests, then review on `dev`, then a release from
`main`. If a local environment cannot run Docker, build, run typecheck and
tests, and hand over the exact local start-up steps labelled unverified.

## Deferred

- Background workers and legal ingestion get their own containers when they do
  something worth deploying.
- Signing desktop updates waits for code signing in general. Until then the
  desktop app auto-updates from unsigned GitHub Releases; see
  `desktop-release.md`.
