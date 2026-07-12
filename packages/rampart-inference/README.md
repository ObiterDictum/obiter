# Vendored Rampart inference

Derived from `@nationaldesignstudio/rampart@0.1.3` (npm tarball shasum `9d95f9efb5920ddeb883fdb591b2fd3abb562ab6`), copyright National Design Studio and contributors, under **CC-BY-4.0**. The upstream `LICENSE` is retained.

This server-only subset retains: `heuristics` (structured PII regex/checksums), `validators` (Luhn/SSN validation), `types` (labels/spans), `policy` (heuristic overlap reconciliation), `premask` (offset-preserving masking/projection), and `ner/classifier` (lazy Transformers.js load, token windowing, BIO decoding and offsets). Every retained source module was reviewed. It has no install scripts, telemetry, or network client; only Transformers.js can download configured model artifacts.

Deleted upstream material: chat guard, session placeholders, streaming/browser transform, worker entry, compiled output, examples, benchmarks/evals, and product documentation. Obiter calls the retained lower-level API directly.

The fork defaults to Obiter's `qarlus/rampart` mirror at revision `c3221c5cd838eb69a249ab40f8b442483865f233`; it never defaults to upstream's model id.
