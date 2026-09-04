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
script is run from, probes the API, and prints a paste-ready evidence block.
Exit is non-zero when the web server serves a different checkout or its
provenance cannot be determined; API checkout mismatches also fail. The API
reports what is determinable and says why when it is not.

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
reports the API commit SHA and absolute checkout root. The script compares the
reported root with the checkout under test. Production and older API servers
omit those fields, so API provenance remains not determinable and does not
fail the check by itself.

## Preferred Test Strategy

- add focused tests near the changed behavior
- prefer deterministic tests over broad fragile ones
- test contracts, parsing, state transitions, and critical UI flows
- test behavior through public boundaries, not internals — a pure refactor must not break tests
- do not add shallow tests that only exercise implementation trivia
- do not add tests that cannot fail meaningfully: no tautologies, no asserting constants, no snapshot dumps that mirror implementation
- do not mock the behavior being tested; mock only external boundaries (network, storage, email, clocks, filesystem)
- one test that would have caught a real bug beats ten that would not; bug fixes add or update the test that would have caught the bug

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

## Local CI mirror

`scripts/ci-local.sh` runs the same gates as `.github/workflows/ci.yml` in the
same order (`install` → `typecheck` → `format:check` → `lint` → `test` →
`benchmark:search`). It has been verified green on this machine.

Matching gates is not matching environments: the mirror failed closed without
fontconfig and Liberation faces from 28 August while the pipeline installed
neither until 2 September (#143), so a green mirror never proved CI would
pass. Aligned now; do not assume they stay aligned.

## End-to-end (Playwright)

One proven journey — deliberately small before any suite grows:

`sign in → create an organisation → create a matter → upload a DOCX → see it listed`

```bash
pnpm --filter @obiter/web test:e2e   # or pnpm test:e2e from the repo root
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

- **Meilisearch must be running** at `http://127.0.0.1:7700` with
  `MEILI_MASTER_KEY=search-benchmark-key`, matching the version pinned in
  `ci.yml` (`getmeili/meilisearch:v1.53.1`). Start it with
  `docker run -d --name meili -p 7700:7700 -e MEILI_MASTER_KEY=search-benchmark-key -e MEILI_NO_ANALYTICS=true getmeili/meilisearch:v1.53.1`
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
