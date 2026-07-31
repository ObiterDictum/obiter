# Redact OCR Engine

Status: **deferred, no milestone.** Engine selected and confirmed available; integration
not scheduled. OCR is an explicit Non-Goal of both [Redact PRD 4](../../prds/redact-4-hardening.md)
and [Redact PRD 5](../../prds/redact-5-local-first.md). This record exists so the
decision does not need remaking when it is scheduled.
Date: 2026-07-29

## Current state

Scanned and image-only PDFs are rejected. `demo.md` line 25: standalone runs are
rejected and matter versions fail extraction. `milestones.md` M3 supports DOCX,
text-layer PDF and TXT only. OCR is the gap that closes this.

## Selection: PP-OCRv6 via `ppu-paddle-ocr`

|         |                                                                                            |
| ------- | ------------------------------------------------------------------------------------------ |
| Models  | PP-OCRv6 (Baidu), Apache 2.0                                                               |
| Wrapper | `ppu-paddle-ocr`, MIT                                                                      |
| Runtime | `onnxruntime-node`, runs in Electron with no Python                                        |
| Output  | `detect()` returns `{x, y, width, height}` per text region                                 |
| Sizes   | tiny ~6 MB, small ~30 MB, medium ~139 MB fp32 (INT8 supported, medium should reach ~35 MB) |
| Loading | models accepted as path, URL or buffer, so weights bundle into the installer               |

Both licences are compatible with AGPL, the same check that cleared Rampart's
CC BY 4.0.

## Why not a vision-language model

This is the decisive criterion and it should not be revisited casually.

A generative VLM produces text autoregressively and can emit fluent, plausible text
that is not on the page, particularly on the degraded scans and faxed exhibits that
make up real bundles. In redaction that is the failure we cannot ship: the model
renders "Smith" as "Smyth", the detector never matches it, and we hand a solicitor a
document we have told them is clean.

A detector-plus-recogniser stack fails differently. It returns low confidence or
garbage, visibly, per region, with a box around it. Visible failure is what a review
UI can act on.

Secondary but real: without per-region boxes you can extract text from a scan but
cannot black out the pixels. Text-only OCR yields a detection surface with no way to
act on it.

### Alternatives considered and rejected

- **Unlimited-OCR** (Baidu, MIT, 3B MoE, ~500M active, 93.92 OmniDocBench v1.6).
  Generative, so it fails the criterion above. Its bulk single-pass ingestion
  advantage also largely evaporates under local-first, where firm documents are
  processed on firm machines.
- **PaddleOCR-VL 1.6** (0.9B, 96.33 OmniDocBench v1.6). Same objection, plus
  installer weight.
- **VisionPsy-Nano** (Tether Data, 460M, Apache 2.0, released 2026-07-29). General
  on-device VLM, benchmarked against sub-0.5B on-device models rather than document
  parsers. Grounding/bounding-box support unconfirmed. Not a candidate for the
  redaction path; see `mobile-capture.md` for where it may fit.
- **Cloud OCR** (Textract, Azure Document Intelligence, Google Document AI).
  Disqualified by the local-first principle, no procurement conversation needed.

## Benchmark

The existing synthetic programme (`synthetic-data-plan.md`, `synthetic-v2-*`,
`fine-tuning.md`, `bench:guard`) covers **detection**. OCR needs a separate benchmark
measuring a different thing: character accuracy and box quality under image
degradation.

**Method: work backwards from text we already hold.** Render source text to PDF, then
apply synthetic degradation (skew, noise, JPEG artefacts, fax-grade downsampling,
photocopier streaking). Ground truth is free because the pipeline started from text,
and degradation is dialled to match real bundle quality.

**Use the existing synthetic fictional corpus as the source text, not real judgments.**

The decisive reason is that real judgments buy nothing here. OCR measures character
accuracy and box quality under image degradation. That signal does not depend on
whether the underlying text describes real events, so fictional judgments in the
correct register give the identical measurement. Any licence exposure taken on to
obtain real text is exposure spent for no gain in signal.

The licence position, recorded so it is not re-argued:

- The transactional licence (TNA to Obiter Research Limited, 15 July 2026) grants
  both copying and computational analysis rights, but each is bounded _for the
  Purpose_, and the Purpose is publishing on Obiter.dev plus "case search and
  verification facilities". Benchmarking a redaction product is not that. The Purpose
  clause limits the scope of the grant, so keeping the corpus internal does not cure
  it, although it does reduce practical exposure considerably.
- **Sourcing from BAILII does not change this.** Copyright in a judgment subsists in
  the judgment, not in the site hosting it. BAILII cannot grant rights in Crown
  copyright material that it does not itself hold, and its terms of use are stricter
  than TNA's on automated retrieval. Changing source changes the access route, not
  the underlying permission.
- Publishing a benchmark derived from judgments would compound the position, since
  `data/bench/uk-legal-pii/README.md` commits to a public release and restriction
  (a)(ix) obliges us to prevent third-party scraping of judgment contents.

**Where real documents genuinely help is degradation realism**, that is, confirming
our synthetic artefacts resemble real bundle quality. That needs a handful of real
scans, not a corpus. Judgments are the wrong document type for it in any case, because
Redact processes witness statements, attendance notes and correspondence. The right
source is a small private set from a design-partner firm under the usual agreements,
held internally and never released.

### Position (2026-07-29)

The benchmark itself **is** intended for publication, on the same basis as the PII
benchmark: fictional documents only, so publication raises no licence question. Real
legal text is not required for the measurement and is not being pursued now.

If a future benchmark ever needs real UK legal text and must remain publishable, the
source to reach for is **Open Government Licence material such as
legislation.gov.uk**, which permits commercial use and adaptation without a purpose
limitation. `implementation-plan.md` already names it as the licence-safe fallback
corpus. Judgments under either the Open Justice Licence or our transactional licence
are the wrong place to look, for the reasons above.

Using synthetic source text keeps the OCR benchmark releasable on exactly the same
basis as the PII benchmark ("fictional UK legal documents only; never real personal
data") and removes the licence question from the critical path entirely.

Layer a small set of real scans on top later to calibrate the degradation parameters,
held privately and never released.

**This corpus measures OCR only.** Judgment-register text is fine for character
accuracy, which is largely document-agnostic. It is _not_ a proxy for detection
quality, because Redact processes witness statements, attendance notes, medical
records and correspondence, which differ in register and layout. The two benchmarks
stay separate and measure separate things.

## Confidence gate

Redact's value is that a reviewer can trust the pass. OCR undermines that silently if
a poorly scanned page produces a clean-looking output. Below a per-page confidence
threshold, the UI must show "this page scanned poorly, review manually" rather than
presenting a finished result.

**Open: confirm that per-line or per-word confidence scores surface through the
`ppu-paddle-ocr` output.** The recognition stage almost certainly produces them but
the README does not document it. Check against the types on install. This is a
short verification, not a design risk, but the confidence gate depends on it.

## Open items

- Confidence score availability and granularity (above)
- Tier selection (small vs medium INT8), decided by our own benchmark rather than
  vendor numbers
- Whether to evaluate `@paddleocr/paddleocr-js` as a second option; it advertises
  PP-OCRv6 support but its licence and maintenance were not verified
- Redaction of the image itself: burning boxes into the output PDF is separate work
  from detecting them, and `build-plan.md` line 595 already lists PDF-safe redaction
  as deferred
- Degradation parameter set: which artefacts, at what severity, calibrated against
  what sample of real bundle quality
