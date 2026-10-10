# Microsoft Word round-trip harness (E13 / P0-1)

The audit's release blocker: no recorded check that a real Microsoft Word can
open an Obiter-exported DOCX, save it, and have the result survive a second
Obiter cycle. This harness automates everything except the Word interaction,
and records the Word leg honestly when it happens.

## Lane safety

The harness creates a synthetic account, verifies it with `psql`, and writes
documents through the API — so it must run against an isolated test lane, not
the shared dev stack (`obiter-live` on ports 8787/3000, database `obiter`).
`lane.ts` enforces this before anything is written:

- `--api` and `--web` must be **loopback** origins and must not sit on the
  shared dev ports 8787 or 3000.
- `--db-name` is required and must name a `*_test` database.
- The API's development `/api/health` provenance must name this checkout at
  `HEAD` and the same `.env` file this run resolves, and the web origin must
  serve this checkout — the same contract `apps/web/lane-target.mjs`
  enforces for the Playwright lane.
- The database the API reports itself bound to must equal `--db-name`; a flag
  cannot attest to a write target the server does not share.

Start an isolated lane the same way as for the e2e journey: set
`OBITER_WEB_PORT`, `PORT`, `OBITER_API_ORIGIN`, `DATABASE_URL`,
`OBITER_E2E_DATABASE_URL` and `OBITER_E2E_DATABASE_NAME` in this worktree's
`.env`, then start the API and web dev servers from this checkout.

## What it does

1. Builds the repo's synthetic `full-fidelity-with-w14-ids` OOXML fixture
   (headings, lists, section breaks, headers/footers, tables, images, fields,
   footnotes, endnotes, comments, tracked changes) — deterministic bytes, no
   real legal text.
2. Creates a synthetic account and matter over the real API, uploads the
   fixture, waits for `ready`, exports `cycle-1-obiter-export.docx`.
3. Runs the other two manifest fixtures (`full-fidelity-without-w14-ids`,
   `multi-level-list`) through the same upload→export cycle, recording each
   byte-identity and semantic summary under `obiterCycles` in the manifest.
4. Detects whether Microsoft Word is reachable on this machine.
   - **Word found**: writes `word-step.md` operator instructions.
   - **No Word / only LibreOffice**: records `word.status: "not-checked"` —
     LibreOffice is explicitly reported as NOT being Word and never
     substitutes for the gate.
5. When re-run with `--word-output <file> --word-version "<string>"`, the
   file is checked for evidence Word actually wrote it: it must differ from
   both the input fixture and the cycle-1 export, carry the same body text
   as the cycle-1 export, parse as a DOCX, and its `docProps/app.xml` must
   declare `Microsoft Office Word` as the producer. Anything else is
   recorded as `word.status: "rejected"` with the observed producer and
   the run fails. An accepted file is recorded as `manual-reported` —
   observed producer evidence with `verification: "externally-unverified"`,
   the claimed Word version, and the input and cycle-1 artifact hashes it
   correlates to — then uploaded, exported as
   `cycle-2-obiter-export.docx`, and compared against cycle 1 at OOXML
   level (body text, paragraph/story counts, headings, section breaks,
   fields, styles, numbering, images, comments, tracked changes,
   footnotes, endnotes, opaque parts).
6. Writes `manifest.json` with provenance (git SHA, API origin, API-reported
   commit SHA and checkout, server-reported database, runtime, artifact
   SHA-256s, Word evidence) and the check results. `wordAcceptance` is the
   release gate and stays `not-checked` on every run this harness can
   produce today — see "What it does not claim".

## Usage

```sh
# Cycle 1 — isolated lane ports, not the shared dev stack
bun scripts/word-roundtrip/run.ts \
  --api http://127.0.0.1:8797 --web http://localhost:3005 \
  --db-name obiter_e0_test --out /tmp/word-roundtrip

# Cycle 2 — after the operator saves the file in Word
bun scripts/word-roundtrip/run.ts \
  --api http://127.0.0.1:8797 --web http://localhost:3005 \
  --db-name obiter_e0_test --out /tmp/word-roundtrip \
  --word-output /tmp/word-roundtrip/word-saved.docx \
  --word-version "Microsoft Word for Microsoft 365, version 2405"
```

Substitute the ports and database name this worktree's `.env` actually
declares; the examples above are one isolated lane, not a default.

`--email/--password` substitutes an existing verified account for the
sign-up + verification path when the harness machine cannot reach the
postgres container.

## What it does not claim

- It does not claim Word fidelity from an OOXML parse. The semantic
  comparison is an explicit, scoped structural check between two Obiter
  exports. Visual/behavioural verification inside Word is an operator
  observation recorded through `--word-version` and the manifest.
- The producer check is evidence, not proof of a licensed Word install: an
  operator could hand-edit `docProps/app.xml` — the test suite does
  exactly that — so a Word-named producer earns `manual-reported` with
  `verification: "externally-unverified"`, never a verified verdict. The
  `wordAcceptance` gate therefore stays `not-checked` until an operator
  records open/save/visual evidence outside this harness; only then may a
  human mark it checked.
- A run without `--word-output` means the Word leg has NOT happened; the
  manifest says `word.status: "not-checked"` (or `awaiting-word-step`).
