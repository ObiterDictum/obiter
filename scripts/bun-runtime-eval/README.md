# `bun-runtime-eval` - evaluation harness, not shipping code

One-off harness behind the native `Bun.serve` evaluation recorded in
`docs/bun-serve-runtime-evaluation.md`. Nothing here is referenced by the
application, the build, CI, or deployment: no `package.json` script, import
or config points at this directory, and it must stay that way. If a migration
is ever approved it will re-own these entry points properly; this directory
is evidence and reproduction material only.

## Layout

- `overlay/` - the exact experimental bootstrap changes. `runtime.ts`
  (`createApiRuntime()`, extracted from `server.ts`), `server.ts` (the Node
  adapter plus the identical drain handler the comparison added) and
  `server-bun.ts` (the `Bun.serve` candidate). They compile only when copied
  into `services/api/src/` of a scratch checkout; in this tree their imports
  deliberately resolve nowhere.
- `compare.mjs` - journey matrix and paired-round runner; reuses the existing
  `scripts/load/` tooling for fixtures, provisioning and host observation.
- `gates.mjs` - 59 correctness/compatibility checks run against whichever
  runtime the harness started.
- `timeouts.mjs` - transport timeout characterisation (idle keep-alive,
  half-sent header, stalled body).
- `decompose.mjs` - client-side decomposition of the delta (Meilisearch,
  Postgres, serialisation) with no HTTP server in the path.
- `build-compiled.sh` - the single esbuild pass that emits the two compiled
  rows (`dist/server.js`, `dist-bun/server-bun.js`) inside a scratch checkout.
- `reproduce.sh` - recreates the pinned scratch worktree, overlays the
  harness and re-runs every measurement.

Safety pins are deliberate: the harness refuses to run unless the checkout's
`.env` points at a database named `obiter_bun_eval`, serves on port 8811, and
records neighbouring Obiter unit CPU so a contended run cannot pass for a
quiet one. `BUN_EVAL_BUN` overrides the Bun binary path.

## Reproduce

```bash
scripts/bun-runtime-eval/reproduce.sh
```

Writes only inside `$BUN_EVAL_ROOT` (default `/tmp/obiter-bun-eval`) and the
`obiter_bun_eval` database. Never touches the shared stack on 3000/8787,
other lanes' worktrees or `obiter_lane_*` databases.

## Differences from the run-time originals

The byte-identical harness that produced the reported numbers is preserved
with the raw evidence at
https://github.com/ObiterDictum/obiter-ops/tree/5284e82/evaluations/2026-09-18-bun-serve-runtime
(SHA256SUMS.txt covers every file). The copies here differ only in ways that
cannot change a measurement: `BUN_EVAL_BUN` overrides the previously
hardcoded Bun path, `reproduce.sh` derives paths and the evaluated commit
from the checkout it sits in, two unused bindings in `gates.mjs` were
underscore-prefixed, and Prettier formatting was applied so the repository
gates pass.
