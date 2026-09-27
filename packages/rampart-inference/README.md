# Vendored Rampart inference

Derived from `@nationaldesignstudio/rampart@0.1.3` (npm tarball shasum `9d95f9efb5920ddeb883fdb591b2fd3abb562ab6`), copyright National Design Studio and contributors, under **CC-BY-4.0**. The upstream `LICENSE` is retained.

This server-only subset retains: `heuristics` (structured PII regex/checksums), `validators` (Luhn/SSN validation), `types` (labels/spans), `policy` (heuristic overlap reconciliation), `premask` (offset-preserving masking/projection), and `ner/classifier` (lazy Transformers.js load, token windowing, BIO decoding and offsets). Every retained source module was reviewed. It has no install scripts, telemetry, or network client; only Transformers.js can download configured model artifacts.

Deleted upstream material: chat guard, session placeholders, streaming/browser transform, worker entry, compiled output, examples, benchmarks/evals, and product documentation. Obiter calls the retained lower-level API directly.

The fork defaults to Obiter's `qarlus/rampart` mirror at revision `c3221c5cd838eb69a249ab40f8b442483865f233`; it never defaults to upstream's model id.

## Local divergence from upstream (P0.31)

One behavioural patch is applied on top of upstream and **must be re-applied on
every re-vendor**:

- `src/ner/classifier.ts`, `detectNer`: the final cross-window step calls a
  local `dedupeExactSpans` instead of upstream's `policy.mergeSpans`.
- Effect: overlapping detections from neighbouring token windows are returned
  as separate contributors rather than collapsed under one detection's label.
  Exact duplicate detections (the same entity re-detected in an overlapping
  window) are still dropped, so the single-window and duplicate-collapse
  behaviour is unchanged.
- Rationale: the product's overlap policy (`reconcileRampartSpans` in
  `@obiter/redaction-policy`) owns coverage and disposition. Upstream's
  `mergeSpans` inherits the preferred detection's label for the union, so a
  `keep`-category winner at a window seam could discard a `redact`-required
  contributor before the product boundary saw it (release-board P0.31).
- Not part of the divergence: `policy.ts` and `premask.ts` are byte-faithful and
  still use `mergeSpans`; only `detectNer`'s cross-window step changed. The
  product is the only caller of `detectNer` and already reconciles overlaps.
- Re-vendor check: after applying the upstream tarball, confirm `detectNer`
  does not call `mergeSpans` and still returns overlapping contributors, then
  run `packages/rampart-inference` tests and `services/api` tests
  `redaction-merge-integrity.test.ts` (which drives the real `detectNer` over
  two windows through the finalize route).

## Formatting / linting

This package is **excluded from the repo-wide Prettier, oxlint, and ESLint passes** (see the root `.prettierignore`, `.oxlintrc.json`, and `eslint.config.mjs`). The vendored source is kept byte-faithful to upstream (except the recorded P0.31 divergence above) so that future re-vendors produce clean, reviewable diffs against the original tarball — reformatting or repo-policy lint fixes would erase that correspondence for no behavioural gain. The package still typechecks and runs its own tests via its workspace scripts.

