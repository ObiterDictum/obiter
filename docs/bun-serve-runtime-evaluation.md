# Native `Bun.serve` runtime evaluation

**Status: evaluation complete, packaged for independent review. No migration
has been performed and this document does not approve one. Every
recommendation below is provisional pending that review.**

Headline: serving the identical API on native `Bun.serve` used **47% less
idle memory than the shipping Node + tsx path and approximately 30% less than
compiled Node** (378 MB and 285 MB down to 199 MB), with 1 second faster
readiness, ~13% less server CPU for the same journeys, and lower p50 latency
on most measured routes. The earlier shorthand of "47%" alone compared
against the wrong baseline: tsx inflates the shipping figure, so compiled
Node is the honest primary comparison.

## Provenance

- **Evaluated commit:** `67afb9fa8cdfc0f28729d218cdbb76fc9738329a`
  (`origin/dev`, "Repaginate a document only when its inputs change (#216)").
- **Host:** 4 vCPU AMD EPYC-Rome, 7.5 GiB RAM. Node v24.20.0, Bun 1.4.2
  (`1.4.2+744846f84`, sha256-verified release zip), tsx 4.23.0, esbuild
  0.25.12, PostgreSQL 16, shared Meilisearch at `127.0.0.1:7700`.
- **Raw evidence:** preserved outside the product tree at
  https://github.com/ObiterDictum/obiter-ops/tree/5284e82/evaluations/2026-09-18-bun-serve-runtime
  with `SHA256SUMS.txt` covering every file (verify with `sha256sum -c`).
  That bundle holds the run's own `FINDINGS.md`, every raw measurement JSON,
  a byte-identical harness snapshot and the reproduce pipeline.
- **Harness:** `scripts/bun-runtime-eval/` in this branch; isolated from the
  application, build, CI and deployment (see its README).

## The three configurations

| Row                      | Entry point                                  | Socket layer              | Transform                                   |
| ------------------------ | -------------------------------------------- | ------------------------- | ------------------------------------------- |
| 1. Node + tsx (shipping) | `services/api/src/server.ts`                 | `@hono/node-server` 2.0.0 | `tsx` on-the-fly, as `pnpm dev:api` runs it |
| 2. Compiled Node         | `dist/server.js`                             | `@hono/node-server` 2.0.0 | esbuild, ahead of time                      |
| 3. Native Bun            | `dist-bun/server-bun.js` (and Bun-native TS) | `Bun.serve`               | esbuild, ahead of time                      |

Rows 2 and 3 come from one esbuild pass that bundles first-party source and
leaves every `node_modules` dependency external, so they execute identical
first-party JavaScript and differ only in the socket layer. `@hono/node-server`
was never run under Bun.

The only application change the experiment needed was a behaviour-preserving
extraction of `server.ts` into `createApiRuntime()` (kept at
`scripts/bun-runtime-eval/overlay/runtime.ts`), plus an identical
SIGTERM/SIGINT drain added to both adapters because the shipping `server.ts`
installs no signal handler. Everything else is the same code, routes,
middleware, contracts and database access.

## Measurement procedure

Three paired rounds alternating `node,bun` / `bun,node` start order, same
commit, lockfile, fixtures and database rows, sequential processes with a 5 s
quiet window, warm-up before measurement, and the load generator outside the
measured process. Sample counts: 40 requests at concurrency 4 for
account/matter reads, 24 at 2 for search, 20 at 2 for readiness, 10 and 8 at
2 for the two upload sizes, 8 at 1 for verification, 12 at 1 for inference,
12 and 6 at 2 for downloads, one 30-request keep-alive sequence.

**Contention evidence:** `neighbourContended: []` in every run; the shared
API and web units consumed 27-34 ms and 0.4 ms of CPU across each window;
whole-host busy fraction 0.61-0.75 recorded per run as the "load actually
reached the box" check. Compiled rows were single-run after the paired rounds
established spread.

## Results against compiled Node (primary comparison)

| Metric                                | Compiled Node   | Native `Bun.serve` | Delta       |
| ------------------------------------- | --------------- | ------------------ | ----------- |
| Startup readiness                     | 1056 ms         | 591 ms (549-696)   | -44%        |
| Idle RSS after model warm             | 284.7 MB        | 199.4 MB           | -30%        |
| Peak RSS during sweep                 | 571.2 MB        | 491.7 MB           | -14%        |
| Server CPU, identical sweep           | 78 600 ms       | 68 220 ms          | -13%        |
| `GET /api/matters` p50 / p95          | 12.25 / 22.59   | 6.74 / 10.35       | -45% / -54% |
| `GET /api/matters/:id` p50 / p95      | 8.06 / 10.71    | 5.72 / 9.12        | -29% / -15% |
| `GET /api/me` p50 / p95               | 10.41 / 24.00   | 8.24 / 27.14       | -21% / +13% |
| `:id/documents` p50 / p95             | 12.64 / 21.10   | 13.56 / 21.02      | +7% / -0%   |
| `POST /api/search/fetch` p50 / p95    | 934.4 / 969.3   | 769.7 / 818.4      | -18% / -16% |
| `GET /api/search/readiness` p50 / p95 | 5.15 / 9.58     | 3.02 / 4.39        | -41% / -54% |
| Upload+extract 47 KB p50 / p95        | 136.7 / 160.2   | 116.6 / 138.1      | -15% / -14% |
| Upload+extract 503 KB p50 / p95       | 286.7 / 310.2   | 213.6 / 244.1      | -25% / -21% |
| Verification run p50 / p95            | 41.68 / 51.67   | 41.28 / 58.54      | -1% / +13%  |
| Redaction ONNX run p50 / p95          | 1015.0 / 1120.2 | 1019.4 / 1314.0    | +0% / +17%  |
| Download 47 KB p50 / p95              | 11.34 / 16.89   | 8.23 / 14.51       | -27% / -14% |
| Slow-reader download p50 / p95        | 186.4 / 187.4   | 184.0 / 210.6      | -1% / +12%  |
| Keep-alive, 30 req median             | 4.01 ms         | 3.15 ms            | -21%        |
| Errors across the sweep               | 0               | 0                  |             |

For scale, row 1 vs row 2 isolates the tsx transform cost: readiness 1631 to
1056 ms, idle 378 to 285 MB. Bun still beats compiled Node on both. Two p95
tails (verification, ONNX inference) are slightly worse under Bun and within
run-to-run spread; ONNX itself is runtime-neutral. Decomposition runs show
the search delta is client-side runtime cost, not Meilisearch or Postgres,
and the ~950 ms search figure is dominated by the product's own fan-out
(`storedIndexRerankPoolLimit = 100` through a 10-connection pool), which is a
product observation, not a runtime one.

## Compatibility checks, failures, limitations

- Gate suite: **57/59 under Bun, 56/59 under Node**. The two failures are
  malformed-multipart paths answering 500 on _both_ runtimes (pre-existing,
  runtime-independent). The only check where runtimes differ favours Bun:
  a half-sent header is closed at 12 s under Bun versus a 408 at 81 s under
  Node.
- Native ONNX inference (`onnxruntime-node` N-API, CPU-only install) passes
  identically; `pg`, `better-auth`, `@napi-rs/canvas`, `mammoth`, `jszip`,
  `unpdf`, `pdf-lib`, `resend`, `meilisearch`, `zod` and `execFileSync` all
  exercised through real routes.
- Adapter defaults differ and were pinned explicitly: `idleTimeout: 30`,
  `maxRequestBodySize: 64 MiB` (app-level 48 KiB/25 MiB limits stay
  authoritative), `hostname: '0.0.0.0'` (Bun binds IPv4-only by default where
  Node binds dual-stack), and `Expect: 100-continue` verified on both.
- Not measured: TLS/HTTP2/HTTP3, IPv6 reachability, container images,
  multi-instance behind a load balancer, real reverse-proxy conditions,
  sustained load, the Electron desktop runtime, macOS/Windows, and the search
  lane's ingestion workers.

## Operational blockers

1. Bun exposes no request-header or whole-request deadline (Node's
   `headersTimeout`/`requestTimeout` produce a 408). Enforce at the reverse
   proxy; in-process deadlines would need Hono middleware.
2. `idleTimeout` is one knob covering three Node concepts, including silent
   handlers and quiet response streams; long-lived responses would need
   per-request `server.timeout(req, 0)`.
3. No configurable header-size limit (measured 431 at 64 KiB; threshold and
   shape are Bun internals).
4. Bun renders a source-and-stack error page unless `NODE_ENV=production` /
   `development: false`; any Bun image must pin both.
5. Ongoing cost: a pinned Bun version and upgrade policy, a Bun-runtime CI
   job, and a second deployment image to maintain.

## Proposed migration conditions (provisional)

Provisionally, the evidence supports a migration worth approving: the gain is
on memory and readiness where this host's binding constraint lives, no
functional blocker exists, and the differences are configuration work. Before
any migration PR is opened:

1. Independent review of this document and the raw evidence.
2. Re-measure the two worse p95 tails (verification, ONNX inference) with
   larger samples.
3. Pin Bun exactly (`1.4.2`), treat bumps as changes that re-run gates and
   the paired sweep, and add a Bun-runtime CI job running the API suite plus
   `gates.mjs`.
4. Ship `NODE_ENV=production` and `development: false`, explicit `hostname`,
   `maxRequestBodySize` and `idleTimeout`, and proxy-enforced header/request
   deadlines.
5. Select the adapter by entry point, not an env flag; keep `server.ts` as
   the rollback path.
6. Roll out behind the same route as a canary instance first, comparing
   error rate, p95 and RSS per instance for a fixed window.

## Rollback plan

Rollback is redeploying the previous Node image. The application code is
identical in both adapters (same `createApiRuntime()`), there is no schema or
data migration involved, and `services/api/src/server.ts` remains the
shipping entry point throughout.

## Reproduce

```bash
scripts/bun-runtime-eval/reproduce.sh
```

Recreates a detached scratch worktree at the evaluated commit, overlays the
harness, builds both compiled rows and re-runs every measurement and gate
into `$BUN_EVAL_ROOT/raw` (default `/tmp/obiter-bun-eval`), against the
throwaway `obiter_bun_eval` database only.
