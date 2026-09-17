# Web page-load measurement

Reproducible production page-load measurement and a deterministic bundle-size
budget. Read this before quoting a load number: most wrong performance claims
come from measuring development mode, a stale checkout, or a warm cache while
calling it cold.

## Bundle budget

```bash
pnpm --filter @obiter/web build
pnpm perf:bundle-budget
```

Counts, from the build's own manifest (`__root__.preloads`, which includes the
client entry):

- **initial** — gzip bytes the root route preloads. Every document load pays it.
- **lazy route chunks** — every other emitted client chunk, excluding the PDF
  worker.
- **largest lazy chunk** — catches one route ballooning.
- **pdf worker** — budgeted separately; it is a fixed third-party asset.

Budgets live in `scripts/perf/bundle-budget.mjs` with the measured baseline and
roughly 10% headroom. They are a ratchet against regression, not a target.

## Page-load runner

```bash
Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
  node scripts/perf/web-load-runner.mjs \
    --serve-prod "$PWD" --expect-artifact-commit "$(git rev-parse HEAD)" \
    --web-url http://localhost:3002 --api-url http://localhost:8789 \
    --expect-checkout "$PWD" \
    --fixtures /path/to/fixtures.json \
    --samples 5 --cache cold --nav hard --out /tmp/perf.json
```

`--serve-prod <worktree>` starts `apps/web/serve.mjs` from that worktree behind
a local gateway reproducing production's same-origin split (`/api/*` to the API,
everything else to SSR). Omit it to measure a server you started yourself, such
as `vite dev`; that target has no build marker, so it also needs
`--allow-unverified-artifact`. Credentials are read from the environment and
never written to the report.

The runner attributes a run before it measures anything, and records the three
identities separately because they can diverge:

- **runner** — this harness's own checkout and commit.
- **artifact** — the web build marker written by the package `build` script.
  With `--serve-prod` the marker's commit must equal `--expect-artifact-commit`,
  its dirty flag must be false, it must be a production React build, its sha256
  must match the bytes on disk, and it must match the marker the running server
  reported at `/.well-known/obiter-build`. A stale Before dist under an After
  checkout, a dist replaced after startup, a missing marker and a dirty build
  presented as clean are all refused.
- **API** — `/api/health` provenance must name the expected checkout root.

Every sample is gated on the journey's route-ready control and final path. A
redirect to sign-in, an error screen or a wrong document fails that journey and
is recorded under `failures` with a reason, rather than contributing a timing
under the target's name. Credentials are only required when a selected journey
needs them, so a public-only run needs no `Q18_PERF_*`.

Conditions, which must not be conflated:

| Flag                               | Meaning                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `--cache cold`                     | a fresh browser context per sample (empty HTTP cache) |
| `--cache warm`                     | re-navigate inside one context                        |
| `--nav hard`                       | `page.goto`, a full document load                     |
| `--nav client`                     | click the in-app link, measured from the click        |
| `--emulate-network fast3g\|slow4g` | CDP profile, labelled in the report                   |

The runner refuses to measure unless the API's `/api/health` provenance names
the expected checkout root, so a stale or shared server cannot be measured by
accident. It signs in with a password and reports the final path each journey
reached, so a journey that quietly landed on sign-in is visible.

Metrics per sample: route-ready (`contentMs` = primary control present,
`readyMs` = control present after React hydration), TTFB, FCP, LCP, CLS, long
tasks and total blocking time, request counts and transferred/decoded bytes,
largest scripts, and the API request waterfall.

## Fixtures

`fixtures.example.json` lists the keys the journeys substitute; a journey path
with a placeholder and no matching key is a hard failure before measurement.
Point `--fixtures` at a local file containing real ids from the lane database.
Do not commit that file: it identifies test data, and the point of the runner is
that it can be pointed at any target.
