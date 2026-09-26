# API ingress and rollback harness

Runs the shipped [`infra/traefik/entrypoints.yml`](../../infra/traefik/entrypoints.yml)
fragment verbatim in a disposable Traefik, puts the real Bun and Node API images
behind it, and proves the API's behaviour and the proxy limits **through the
proxy**. It exists because `scripts/api-runtime` drives the entry points
directly: a green runtime integration run says nothing about what Traefik does to
a slow upload, a long download or an oversized header, and nothing about
switching a deployed route between the two runtimes.

## Prerequisites

- Docker, and the pinned `psql` client on `PATH` (fixtures are written with the
  same `scripts/load/psql.mjs` boundary the other harnesses use).
- Both API images, built from one clean checkout so they name the same commit.

```sh
docker build -f services/api/Dockerfile -t obiter-api-bun:ingress \
  --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .
docker build -f services/api/Dockerfile --target runtime-node -t obiter-api-node:ingress \
  --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .
```

## Run

```sh
bun scripts/api-ingress/ingress.mjs \
  --bun-image obiter-api-bun:ingress \
  --node-image obiter-api-node:ingress \
  --json-out /tmp/ingress-report.json
```

Flags: `--bun-image`, `--node-image`, `--json-out`, `--keep` (leave the
containers up), `--verbose` (Traefik debug log). Exit `0` when every check
passes, `1` when a check fails, `2` on a setup error such as a missing image.

## What it checks

Against the shipped config, through the proxy:

- `/api/health` answers and names the Bun adapter (which proves the route, not
  just the listener).
- A provisioned session authenticates at `/api/me`; anonymous `/api/me` is 401.
- A real DOCX uploads, reaches `ready`, and downloads byte-identically to a
  reader that pauses, so backpressure has to drain.
- A multi-MiB text document uploads and streams back.
- A 4 KiB header reaches the origin; a 64 KiB header is refused with 431.
- A 25 MiB upload paced at ~640 KiB/s completes in ~40 s inside `readTimeout`.
- A ~10 s download completes, because `writeTimeout` is disabled.
- The route switches Bun → Node → Bun with health and the same session re-proved
  at each step, and both images carry the same revision label.
- A SIGTERM sent while an upload body is still arriving: the process is still
  draining at the signal, the upload completes with 201, the process exits 0,
  and the drain log reports the open connection and the closed pool.

Against a second proxy configured with `readTimeout`/`writeTimeout` at 5 s:

- An upload that needs ~9.6 s is cut at ~5 s with partial progress.
- A ~10 s download is cut at ~5 s with partial progress.

The control run is what makes the shipped values load-bearing: without it, a
check would pass even if Traefik ignored the configuration.

## Isolation

Task-owned and removed at teardown: one docker network, six containers
(postgres, two Traefik, origin, Bun, Node) and a temporary directory. The
database is a task container, never the shared one; every port is an OS-allocated
loopback port; fixture SQL is refused unless it names an owned database. Traefik
runs **without the Docker socket**, so the disposable proxy has no authority over
any other container. No request leaves this machine: the origin is a local
container and Meilisearch is a deliberately dead hostname. The only external
contact is pulling the pinned images.

The origin (`origin.mjs`) is a synthetic HTTP server, not the product API. It
exists because a real upload cannot be paced to a chosen duration on demand; the
product's own behaviour through the same proxy is proved separately against the
real images.

## Pin

Traefik `v3.6.25`, checked against its digest at run time. That is Dokploy's
default image (`TRAEFIK_VERSION`); confirm the deployed server actually runs it
before trusting the fragment there, and re-run the harness after any Traefik or
fragment change.

## What this does not prove

- The running production Traefik's version and configuration — this machine
  cannot read the server.
- Dokploy's build-target selection itself; it proves the two images and a route
  switch, not Dokploy's `dockerBuildStage` plumbing.
- TLS, HTTP/2 or HTTP/3, including their different header limits.
- Multi-instance behaviour, sustained load, or a canary.
