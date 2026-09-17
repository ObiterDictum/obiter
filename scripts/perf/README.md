# Bundle and page-load measurement

Reproducible production measurement of what ships and how fast it loads: a
deterministic web bundle budget, a deterministic desktop size budget, and a
page-load runner. Read this before quoting a load number: most wrong performance
claims come from measuring development mode, a stale checkout, or a warm cache
while calling it cold.

## Web bundle budget

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

## Desktop size budget

```bash
pnpm --filter @obiter/desktop build
pnpm perf:desktop-budget
```

Counts, from the renderer's Vite manifest
(`apps/desktop/out/renderer/.vite/manifest.json`) and from the build output on
disk:

- **renderer initial** — the entry chunk, its static-import closure, and the CSS
  those chunks use. Every open window pays it.
- **lazy chunks** — chunks reached only through dynamic imports (the PDF viewer),
  and their lazy CSS.
- **largest lazy chunk** — catches one lazy surface ballooning.
- **worker payload** — scripts referenced as assets (the PDF worker), parsed only
  when a worker is constructed.
- **product assets** — fonts, shipped in the asar but fetched by CSS only when a
  face is used.
- **main / preload** — the Electron entry bundles.
- **application payload** — every emitted file the packager reads, so a bucket
  the script does not name still cannot grow unnoticed.

Sizes are raw bytes on disk, not gzip. A packaged renderer is read from the local
asar over the custom `obiter://` protocol, never transferred over HTTP, so
compression is not part of the cost; the web budget above uses gzip because the
browser downloads it. The two numbers must not be compared as if they measured
the same thing. `main` and `preload` are contract-sized entry bundles and get
absolute ceilings rather than a percentage.

Budgets live in `scripts/perf/desktop-budget.mjs` with the measured baseline and
roughly 10% headroom. A missing build, a missing or malformed manifest, a
manifest entry with no file on disk, or a zero-byte file fails the check rather
than measuring as a passing zero. CI builds the desktop app immediately before
running it; run it on a fresh build locally too.

Not covered: the Electron runtime and the platform installer. That figure is
platform-specific — Windows NSIS is the primary target and is built only by
`desktop-release.yml` on `push: main` on `windows-latest` — so a Linux number
must not be presented as a Windows or macOS one. Measuring the installer is the
remaining open part of X25; see board D10 and P1.37.

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
  its dirty flag must be false, it must be a production React build, the
  sha256 over its `dist/client/assets` must match the bytes on disk, and it must
  match the marker the running server reported at `/.well-known/obiter-build`.
  A stale Before dist under an After checkout, a dist replaced after startup, a
  missing marker and a dirty build presented as clean are all refused. The
  digest covers client assets only; a post-build edit to the server bundle
  (`dist/server/server.js`) is a known limitation, not covered.
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
