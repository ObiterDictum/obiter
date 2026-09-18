# `bun-runtime-eval` — evaluation harness, not shipping code

One-off harness behind the native `Bun.serve` evaluation recorded in
`docs/bun-serve-runtime-evaluation.md`. Nothing here is referenced by the
application, the build, CI, or deployment: no `package.json` script, import
or config points at this directory, and it must stay that way. If a migration
is ever approved it will re-own these entry points properly; this directory
is evidence and reproduction material only.

## Layout

- `overlay/` — the exact experimental bootstrap changes. `runtime.ts`
  (`createApiRuntime()`, extracted from `server.ts`), `server.ts` (the Node
  adapter plus the identical drain handler the comparison added) and
  `server-bun.ts` (the `Bun.serve` candidate). They compile only when copied
  into `services/api/src/` of a scratch checkout; in this tree their imports
  deliberately resolve nowhere.
- `compare.mjs` — campaign entry point: arguments, fixture seeding and the
  paired-round orchestration. The journey matrix lives in
  `lib/journeys.mjs`, the per-run measurement in `lib/measure.mjs`, process
  accounting in `lib/proc.mjs`, statistics in `lib/stats.mjs` and runtime
  start/stop in `lib/server.mjs`.
- `gates.mjs` — 59 correctness/compatibility checks. `lib/gates/harness.mjs`
  holds the shared state and request helpers; the check groups live in
  `lib/gates/checks-{identity,limits,content,transport}.mjs`.
- `timeouts.mjs` — transport timeout characterisation (idle keep-alive,
  half-sent header, stalled body).
- `decompose.mjs` — client-side decomposition of the search delta against the
  route's own stored-search path, with no HTTP server in the path.
- `analyze.mjs` — derives every published table from the raw measurement JSON
  and emits the artifact-to-table mapping.
- `build-compiled.sh` — the single esbuild pass that emits the two compiled
  rows (`dist/server.js`, `dist-bun/server-bun.js`) inside a scratch checkout.
- `reproduce.sh` — recreates the pinned scratch worktree, overlays the
  harness and re-runs the paired campaigns, decomposition, gates, timeout
  probes and table generation.

`compare.mjs` and `gates.mjs` are each under the RULES.md 500-line ceiling;
the split is by ownership (matrix vs runner, check group vs harness), not
formatting.

## Flags worth knowing

- `--pair a,b --rounds N` runs two runtimes in both orders across N rounds;
  `--runtime x` runs one.
- `--journey-requests name=n,...` raises a single journey's sample count, which
  is how verification and ONNX inference are re-measured at n=120.
- `--rss-interval-ms` sets the process-tree sampling interval (default 250 ms).
- `--quiet-probe-ms` / `--require-quiet` record, and optionally refuse to run
  without, an idle host before the campaign.

## Safety pins

The harness refuses to run unless the checkout's `.env` points at a database
named `obiter_bun_eval`, serves on port 8811, and records neighbouring Obiter
unit CPU and whole-host busy fraction so a contended run cannot pass for a
quiet one. `BUN_EVAL_BUN` overrides the Bun binary path.

## Reproduce

```bash
scripts/bun-runtime-eval/reproduce.sh
```

Writes only inside `$BUN_EVAL_ROOT` (default `/tmp/obiter-bun-eval`) and the
`obiter_bun_eval` database. Never touches the shared stack on 3000/8787, other
lanes' worktrees or `obiter_lane_*` databases.

## Evidence

- Revision 2 (the numbers this harness currently produces):
  https://github.com/ObiterDictum/obiter-ops/tree/d7dd3320fdcee7cfdc94ba123e41a7919ed64ab3/evaluations/2026-09-18-bun-serve-runtime/revision-2
  — includes a byte-identical snapshot of this harness plus `SHA256SUMS.txt`.
- Revision 1 (retained, partially superseded):
  https://github.com/ObiterDictum/obiter-ops/tree/5284e82/evaluations/2026-09-18-bun-serve-runtime
  — the byte-identical harness that produced the original numbers.

The copies in this tree differ from the revision-1 originals deliberately:
the files above were split into modules to meet the file ceiling,
`analyze.mjs` was added, `compare.mjs` gained paired-compiled and
per-journey-count flags, `decompose.mjs` now exercises the route's fan-out,
memory is sampled on an interval, and `reproduce.sh` derives paths and the
evaluated commit from the checkout it sits in. `BUN_EVAL_BUN` overrides the
previously hardcoded Bun path.
