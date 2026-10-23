# Testing Rules

## Purpose

Use this file to decide what verification is required before considering a change complete.

## Expectations

- Every non-trivial change must be verified.
- Verification should be proportionate to risk.
- Legal-critical paths need stronger verification than cosmetic changes.

## Minimum Standard

For most changes, do all applicable items:

- run the relevant automated tests
- run linting or typechecking if the area depends on it
- manually exercise the changed behavior
- verify the failure path if the feature is safety- or trust-related

## Confirm the running code

Before claiming anything about behaviour in a running app, prove each server
is serving the checkout under test. `scripts/verify-provenance.sh` resolves
the filesystem path the web dev server loads modules from (the absolute
paths Vite embeds in served modules), compares it against the checkout the
script is run from, probes the requested API, and prints a paste-ready evidence
block. Exit is non-zero when the web server serves a different checkout or its
provenance cannot be determined. API unreachable, HTTP-error, non-stack, root
mismatch, env-file mismatch (including a development API that resolved no
`.env` and reports `envFile: null`), and reported commit-SHA mismatch responses
also fail. A reachable stack health response with absent development provenance
fields is the only non-failing API absence case; the API reports what is
determinable and says why when it is not.

When a browser-observed claim depends on an edit being live, pass a literal
marker from that edit with `--expect <marker>`, for example:

```bash
scripts/verify-provenance.sh http://localhost:3000 http://localhost:8787 --expect "unique text from the edit"
```

The marker must occur in the served web module. An absent marker fails and
names stale or cached modules as the likely cause of Vite serving pre-edit
transformed code while the path still matches. Without `--expect`, the script
prints `revision freshness: NOT CHECKED (no expected-marker given)` and proves
only the checkout path, not the revision being served.

A path match proves the server was started from the named checkout, not that
it is running the latest commit. A dev server started before a checkout,
pull, or commit change keeps serving the old code while the path still
matches, so the script labels the checkout HEAD and its dirty state and the
check never replaces a restart: restart the dev server after any checkout
change, then verify.

Prove every server separately. The API and web server can be running from
different checkouts at the same time, and the symptom looks like a product
bug, not a stale server. A page reload is not proof — the server keeps
serving cached transformed modules after the working tree moves underneath
it.

Where agents run in per-task worktrees, start the servers from the current
task's worktree at the start of the task. The previous task's worktree is
stale but plausible: it holds its own copy of the code, so its servers
answer requests and pass health checks while serving the previous change.

If a marker check turns up stale: clear `node_modules/.vite` and restart the
web server; a change in a workspace package the API imports needs the API
restarted too, not just the web server. In development, `/api/health` also
reports the API commit SHA, absolute checkout root and the `.env` it resolved.
The script compares each reported field with the checkout under test, so a
same-root stale API commit or a lane running with another worktree's `.env`
also fails. Production and older API servers omit those fields, so API
provenance remains not determinable and does not fail the check by itself.

## What Earns a Test

A test earns its place when it breaks because behaviour a user or lawyer relies
on broke, and survives a refactor that keeps that behaviour. Volume is a cost:
every test is code to read, run and keep green.

Three layers, each owning different risks:

- **End-to-end (Playwright):** one journey per core workflow — search, matter
  and document, editing with tracked changes, Verify, Redact. Proves the pieces
  connect. Not the place for edge cases.
- **API tests against real Postgres:** permissions, organisation and matter
  isolation, share revocation, audit records, version immutability. These are
  the confidentiality guarantees and are never thinned.
- **Unit tests:** only for pure, high-risk logic — OOXML writing and byte
  preservation, quote and citation matching, redaction rendering, parsing. One
  test per behaviour, not per function or per branch.

Rules:

- one layer per rule: assert a behaviour at the cheapest layer that can catch
  it, not again at every layer above it
- test behaviour through public boundaries, not internals — a pure refactor
  must not break tests; do not pin call counts, operation order or payload
  shape unless that is the contract
- no tests that cannot fail meaningfully: no tautologies, no asserting
  constants, no snapshot dumps that mirror implementation, no component tests
  that restate markup
- do not mock the behavior being tested; mock only external boundaries
  (network, storage, email, clocks, filesystem)
- bug fixes add or update the one test that would have caught the bug; one
  test that would have caught a real bug beats ten that would not
- a change that adds many tests and removes none should say why in the PR

Deleting tests is normal maintenance. Before removing a group, prove what
remains still guards the behaviour: reintroduce a known regression, confirm a
remaining test fails, then restore the fix. Record the regression used in the
PR.

## High-Risk Areas

Use extra care for:

- auth and session handling
- document versioning and sync
- redaction behavior
- verification logic
- storage and deletion behavior
- audit logging

For these areas, verify:

- happy path
- failure path
- permission or boundary behavior where relevant
- no silent data loss

## Reporting Test Results

When summarizing work:

- state exactly what was run
- state any manual flows exercised
- state what could not be tested
- do not imply coverage that does not exist

## Real-corpus search relevance

`bun run benchmark:search-corpus` measures `POST /api/search/fetch` against the
local product `legal_authorities` index. It is not a CI gate and is not part
of `scripts/ci-local.sh`: CI has no copy of the 37k-document corpus, and the
fixture benchmark in `packages/search-client` already covers the engine
adapter on synthetic documents.

Run it before and after any ranking change. It refuses to measure unless
`GET /api/search/readiness` reports `ready` with the baseline document count,
re-checks every held id and every absent citation against Postgres, and fails
if the count moves during the run. Do not ingest while it is running.

UKSC, UKPC, and both Court of Appeal divisions are complete, so expectations
drawn from them stay valid as High Court later gains pre-2020 material. If
the document count changes, re-verify the absent-citation cases before
updating `scripts/search-corpus-relevance/baseline.ts`. The baseline records
today's numbers including failures; ranking work ratchets those floors, it
does not tidy failing cases out of the set.

## Real-corpus legislation relevance

`bun run benchmark:legislation-corpus` measures the legislation group of
`POST /api/search/fetch` against the local product `legislation_provisions`
index — held recall, held precision, absent precision, and MRR. It is the
legislation counterpart of the judgment suite above, kept separate because a
short provision and a long judgment are not the same ranking problem: a
five-term subject query needing every term inside one provision behaves
nothing like the same query against judgment prose.

Point `LEGISLATION_RELEVANCE_API_BASE` at the API serving the checkout under
test; the run records two provenance identities and prints both: the runner
checkout's own commit, and the measured API's `/api/health` provenance. They
can differ, and the report names each by owner (`runnerCommitSha` /
`apiCommitSha`) rather than one ambiguous field. It refuses to measure unless
`GET /api/search/readiness` reports the legislation index ready
at the baseline document count, then re-checks every held id and every absent
expectation against Postgres, and fails if the count moves during the run. Do
not rebuild the index while it is running.

The report records the search-time parameters the measured server reports
applying (`diagnostics.legislationSearchParameters`), and the run refuses when
the server states none. `matchingStrategy` is a request-time parameter, so no
index setting reveals it: reporting the local constant would mislabel a run
against a server on a different checkout.

`heldPrecision` covers complete-answer (exact) queries only — Act titles,
chapter numbers, section and schedule lookups. Subject-matter cases list a
verified lower bound on the relevant set and score recall and MRR, not
precision. Absent cases are a third of the set and are the point: an Act the
corpus does not hold, a provision that does not exist, a chapter number with
no stored Act, or a concept no provision states. With `matchingStrategy:
'all'` those still serve provisions that merely mention the words.

If the document count changes, re-verify the expectations before updating
`scripts/legislation-relevance/baseline.ts`. The baseline records today's
numbers including the failing absent cases; ranking work ratchets the floors,
it does not tidy failing cases out of the set.

## Local CI mirror

`scripts/ci-local.sh` runs the same gates as `.github/workflows/ci.yml` in the
same order (`install` → `typecheck` → `format:check` → `lint` → `test` →
`benchmark:search` → `bun:api-runtime`). The last one starts the real API under
native `Bun.serve` and the Node rollback entry point; it needs the Bun version
`bun-version` pins (`BUN_BIN` overrides the PATH lookup). It has been verified
green on this machine.

Matching gates is not matching environments: the mirror failed closed without
fontconfig and Liberation faces from 28 August while the pipeline installed
neither until 2 September (#143), so a green mirror never proved CI would
pass. Aligned now; do not assume they stay aligned.

## End-to-end (Playwright)

One proven journey — deliberately small before any suite grows:

`sign in → create an organisation → create a matter → upload a DOCX → see it listed`

```bash
bun run --filter @obiter/web test:e2e   # or bun run test:e2e from the repo root
```

The config lives in `apps/web/playwright.config.ts` (chromium only). `webServer`
starts the API and web dev servers so a single command runs everything;
Postgres and Meilisearch must already be running. If either is unreachable the
run fails fast with an actionable `docker start …` message (same style as
`scripts/ci-local.sh`).

Fixture: `data/evals/redact/demo-fixture.docx` (synthetic, fictional names —
no new binary added).

Not yet wired into `scripts/ci-local.sh` or CI — intentionally. Prove it green
locally twice in a row before promoting it to a gate; a flaky e2e in the gates
is worse than no e2e.

## Host prerequisites (found the hard way):

- **Playwright Chromium must be installed** to run the `services/redaction-renderer`
  suite: `bun --bun playwright install chromium`. The worker launches the real
  browser its renderer ships against, and Playwright fetches browsers on demand
  rather than during `bun install`. CI installs it before the test step;
  `scripts/ci-local.sh` runs the same install.

- **Meilisearch must be running** at `http://127.0.0.1:7700` with
  `MEILI_MASTER_KEY=obiter-local-dev-key`, matching the version pinned in
  `ci.yml` (`getmeili/meilisearch:v1.53.1`). Start it with
  `docker run -d --name meili -p 7700:7700 -e MEILI_MASTER_KEY=obiter-local-dev-key -e MEILI_NO_ANALYTICS=true getmeili/meilisearch:v1.53.1`
  or `docker start meili` if you already have a stopped container.
- **fontconfig and fonts-liberation must be installed.** Without them the PDF
  glyph cover tests in `services/api` fail by fractions of a point, because
  `pdf.js` substitutes a system font when rendering base-14 fonts and the
  redaction cover geometry is measured against rendered ink. This is worth
  stating explicitly: the failure looks like a code regression and is not.
  Install with `sudo apt-get install fontconfig fonts-liberation`, then
  `sudo fc-cache -f`. CI pins `FONTCONFIG_FILE` to
  `.github/fontconfig-liberation.conf` so pdf.js `local()` aliases cannot
  pick DejaVu/Nimbus/Ubuntu instead of Liberation, rebuilds that cache, and
  fails closed if `fc-list` still shows no Liberation faces.
  `scripts/ci-local.sh` exports the same `FONTCONFIG_FILE` and cache dir before
  rebuilding, then fails closed the same way.
