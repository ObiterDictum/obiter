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
    --serve-prod "$PWD" \
    --web-url http://localhost:3002 --api-url http://localhost:8789 \
    --expect-checkout "$PWD" \
    --fixtures /path/to/fixtures.json \
    --samples 5 --cache cold --nav hard --out /tmp/perf.json
```

`--serve-prod <worktree>` starts `apps/web/serve.mjs` from that worktree behind
a local gateway reproducing production's same-origin split (`/api/*` to the API,
everything else to SSR). Omit it to measure a server you started yourself, such
as `vite dev`. Credentials are read from the environment and never written to
the report.

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

`fixtures.example.json` lists the keys the journeys substitute. Point
`--fixtures` at a local file containing real ids from the lane database. Do not
commit that file: it identifies test data, and the point of the runner is that
it can be pointed at any target.
