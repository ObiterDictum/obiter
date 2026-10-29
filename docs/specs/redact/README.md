# Redact Spec

Priority: `P4`

Redact is the privacy layer. It must be conservative, reviewable, and safe by export design.

## Product rules

- A Redact copy may be filed into any matter the user can edit. There is no
  "redaction matter" and no matter type of its own.
- Anything Redact produced is marked as Redact's wherever it appears, and links
  to the run for a reader who may open it.
- The full JSON audit stays the restricted evidence record; the shareable
  export is the one that can be handed to the other side.

Details: [implementation.md](implementation.md) · [api.md](api.md)

## Design records (2026-07-29)

| Record                                                                                                                                     | Scheduled as                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [local-first.md](local-first.md) — local processing, forced update, content-free audit schema, hash attestation, consent-gated diagnostics | [Redact PRD 5](../../prds/redact-5-local-first.md) |
| [ocr.md](ocr.md) — PP-OCRv6 via `ppu-paddle-ocr`, why not a generative VLM, benchmark method                                               | Deferred, no milestone                             |
| [detection-uk-tuning.md](detection-uk-tuning.md) — what UK fine-tuning should and should not target                                        | Not scheduled                                      |
| [mobile-capture.md](mobile-capture.md) — handwriting ingestion, end-to-end encrypted relay                                                 | Exploratory                                        |
