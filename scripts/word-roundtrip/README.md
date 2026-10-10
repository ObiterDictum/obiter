# Microsoft Word round-trip harness (E13 / P0-1)

The audit's release blocker: no recorded check that a real Microsoft Word can
open an Obiter-exported DOCX, save it, and have the result survive a second
Obiter cycle. This harness automates everything except the Word interaction,
and records the Word leg honestly when it happens.

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
5. When re-run with `--word-output <file> --word-version "<string>"`, uploads
   the Word-saved file, exports `cycle-2-obiter-export.docx`, and runs an
   OOXML-level semantic comparison (body text, paragraph/story counts,
   headings, section breaks, fields, styles, numbering, images, comments,
   tracked changes, footnotes, endnotes, opaque parts) between the two
   exports.
6. Writes `manifest.json` with provenance (git SHA, API origin, runtime,
   artifact SHA-256s, Word version claim) and the check results.

## Usage

```sh
# Cycle 1 — needs a running API + reachable postgres for email verification
bun scripts/word-roundtrip/run.ts \
  --api http://localhost:8787 --web http://localhost:3000 \
  --db-name obiter_e13_test --out /tmp/word-roundtrip

# Cycle 2 — after the operator saves the file in Word
bun scripts/word-roundtrip/run.ts \
  --api http://localhost:8787 --web http://localhost:3000 \
  --db-name obiter_e13_test --out /tmp/word-roundtrip \
  --word-output /tmp/word-roundtrip/word-saved.docx \
  --word-version "Microsoft Word for Microsoft 365, version 2405"
```

`--email/--password` substitutes an existing verified account for the
sign-up + verification path when the harness machine cannot reach the
postgres container.

## What it does not claim

- It does not claim Word fidelity from an OOXML parse. The semantic
  comparison is an explicit, scoped structural check between two Obiter
  exports. Visual/behavioural verification inside Word is an operator
  observation recorded through `--word-version` and the manifest.
- A run without `--word-output` means the Word leg has NOT happened; the
  manifest says `word.status: "not-checked"` (or `awaiting-word-step`).
