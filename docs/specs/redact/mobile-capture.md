# Mobile Capture and Handwriting Ingestion

Status: **exploratory**. No commitment, no milestone. Recorded so the design
constraints are known before anyone starts.
Date: 2026-07-29

## The idea

A phone application that photographs handwritten material (attendance notes,
counsel's annotations, marginalia) and ingests it into a matter as searchable text.

This is genuinely differentiated. Handwritten notes are ubiquitous in practice and
almost universally unsearchable.

## Handwriting is not printed OCR

Handwriting recognition is a different problem from the printed OCR in `ocr.md`.
PP-OCRv6 is a printed-text stack and will be poor at cursive. HTR error rates are
materially higher than print.

**This is where a generative VLM earns its place.** The objection in `ocr.md` was
specific to the redaction path, where hallucinated text becomes a missed detection.
For ingestion, errors are cheap and a language prior actively helps.

[VisionPsy-Nano](https://tether.io/news/tether-data-open-sources-visionpsy-nano-best-in-class-460m-on-device-vision-language-model-leading-industry-benchmarks/)
(Tether Data, 460M, Apache 2.0, released 2026-07-29) targets exactly this: on-device
mobile inference, tested on Pixel 9, Galaxy S23/S25 Ultra and iPhone 15, with two
variants including a latency-optimised "Flash" at roughly 99% of full performance.
Claims first place among sub-0.5B on-device VLMs at an overall normalised 62.3, and
wins on 16 of 17 benchmarks against Liquid AI and Hugging Face models in that class.

Note the class is narrow: best tiny on-device generalist, not best document parser.
That is the right tool for this job and the wrong one for `ocr.md`.

## Ingestion, not redaction

The pipeline is: capture, transcribe, **human verifies the transcript**, then the
verified text becomes a normal matter document that Redact processes exactly as it
would a DOCX.

That works because the review gate sits at ingestion, once, performed by the person
who wrote the note and can read their own handwriting. It has to sit there: a
mis-transcribed name is a name Rampart never sees.

**Do not redact handwriting images directly.** Redacting transcribed text leaves the
original handwritten name visible in the image, and HTR box quality on cursive is
worse than on print. If image redaction is ever needed it requires burning boxes into
the image and full page-by-page human review.

**Open: policy for the original scan.** After verification, keeping the image
alongside the transcript means holding an unredacted copy of the same content in a
form redaction cannot touch. Either discard after verification, or classify it so it
never flows into redaction output.

## Transport: end-to-end encrypted relay

Under local-first, phone-to-desktop cannot route through a server that can read the
content. Decided: end-to-end encrypted relay. Visible to the uploading account, and
to the organisation's team where the account belongs to one. We hold ciphertext only.

Local network transfer was considered and is workable but fails across networks,
which is most of the realistic use (a solicitor photographing notes at court).

### The hard part is key management, not encryption

Multi-recipient encryption needs a key hierarchy: a per-organisation key wrapped per
user. That part is standard. What kills end-to-end products is the combination of
requirements now committed to simultaneously:

1. Someone **joins** the organisation and needs access to material encrypted before
   they arrived
2. Someone **leaves** and should lose access going forward
3. Someone **loses their device**, and if we hold no keys their data is simply gone

Law firms will not accept unrecoverable data. So an organisation-held recovery key or
escrow is required, and once it exists we must be able to state precisely who can
invoke it, under what conditions, and what is logged when they do. That is the first
question a firm's IT will ask.

This is the same tension as the diagnostics escrow in `local-first.md`, but here it
is unavoidable rather than held in reserve.

**This must be designed before implementation, not discovered during it.**

## Open items

- Confirm whether VisionPsy-Nano supports grounding / bounding-box output. Not
  required for ingestion, but it would widen the options if present
- Key hierarchy design: rotation, join and leave semantics, recovery invocation and
  its audit trail
- Original scan retention policy
- Whether this is a separate application or a mode within the existing desktop
  product
