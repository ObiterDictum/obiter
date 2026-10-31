# Bundle and desktop size budgets

These two checks gate CI, so they stay here. They are deterministic size
measurements of what ships; every other performance and quality measurement now
lives in the private bench repository
([ObiterDictum/bench](https://github.com/ObiterDictum/bench)) — page-load
journeys, editor interaction, operation latency, statistics and comparison.
Bench drives a built Obiter checkout as a black box; this directory owns only
the numbers CI must refuse to let grow.

## Web bundle budget

```bash
bun run --filter @obiter/web build
bun run perf:bundle-budget
```

Counts, from the build's own manifest (`__root__.preloads`, which includes the
client entry):

- **initial** — gzip bytes the root route preloads. Every document load pays it.
- **lazy route chunks** — every other emitted client chunk, excluding the PDF
  worker.
- **largest lazy chunk** — catches one route ballooning.
- **pdf worker** — budgeted separately; it is a fixed third-party asset.

Budgets live in `scripts/perf/bundle-budget.mjs` with the measured baseline and
roughly 3% headroom. They are a ratchet against regression, not a target. The
script refuses a dist whose build marker names another commit, so a stale build
cannot measure as current.

## Desktop size budget

```bash
bun run --filter @obiter/desktop build
bun run perf:desktop-budget
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

## Feeding bench

Both scripts take `--json <path>` so bench can record the sizes next to a timed
result:

```bash
bun run perf:bundle-budget --json .obiter/bundle-budget.json
bun run perf:desktop-budget --json .obiter/desktop-budget.json
```

Bench reads those two files from the measured checkout when they exist and
records the numbers in `budgets`. It never re-derives them.
