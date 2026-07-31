# Redact 5: Local-First Processing and Content-Free Audit

Status: planned. Follows [Redact 4](redact-4-hardening.md), which remains the active PRD.

Design record: [`docs/specs/redact/local-first.md`](../specs/redact/local-first.md).
This PRD is the schedule and the requirements; the record is the reasoning.

## Summary

Redact processes documents server-side. This PRD moves processing onto the user's
machine for the desktop application, and reduces what the server holds to content-free
run metadata plus cryptographic hashes.

It supersedes the deferral at `docs/specs/redact/build-plan.md` line 165, which placed
desktop-local redaction in M3+ scope without a plan.

## Problem

Three things are true at once and only the first is currently served.

**Redact works, and the server sees everything.** Extraction, detection and storage all
happen server-side, which makes Obiter a processor holding privileged client material.
That is a procurement conversation with every firm, and it is the weaker position
against cloud competitors rather than a differentiator.

**The detection engine does not need the server.** `@obiter/rampart-inference` has one
dependency, `@huggingface/transformers`. The model is 18.5M parameters in 14.7 MB,
running at ~6.6 ms p50 on CPU. `apps/desktop` already builds and ships. The blocker is
text extraction, not inference.

**We are blind to failure by design, and have no signal replacing it.** [Redact
4](redact-4-hardening.md) closed the trust defect where degraded detection was invisible
to reviewers, but its own Open Questions (lines 144 to 145) ask how often degraded mode
actually triggers, and whether degraded runs should be finalizable at all under
`external_sharing`. Nothing currently measures that. Local-first makes the question
sharper, because once documents stay on the user's machine, aggregate signal is the only
signal there is.

## Goals

- Documents processed on the desktop never reach the server.
- The server holds enough to satisfy audit and attestation, and nothing more.
- A firm can prove a specific file was processed, without Obiter holding the file.
- We acquire a content-free quality signal, which also answers Redact 4's open question.
- Retention is defined, defensible and enforced by a job rather than by policy.

## Non-Goals

Deferred, with design records written but no milestone. Do not pull these forward.

- **OCR for scanned documents.** Engine selected and verified as available
  ([`ocr.md`](../specs/redact/ocr.md)) but not scheduled. Also a Non-Goal of Redact 4.
- **Mobile capture and handwriting ingestion.** Exploratory only
  ([`mobile-capture.md`](../specs/redact/mobile-capture.md)).
- **UK fine-tuning of Rampart.** Separate track
  ([`detection-uk-tuning.md`](../specs/redact/detection-uk-tuning.md)).
- Rebuilding detection, review, output or audit. They work.
- Removing the hosted web path. Both surfaces stay full-featured (see FR3).

## Functional Requirements

### FR1: Content-free telemetry

- **FR1.1.** Runs MUST record span counts by category and by source, detection mode,
  model and policy version, duration, page count and outcome status.
- **FR1.2.** Runs MUST record reviewer actions as counts per category: spans accepted,
  rejected, and manually added. Rejections give the false-positive rate; manual
  additions give the false-negative rate. This is the primary quality signal and MUST
  NOT be derived later from records not designed to carry it.
- **FR1.3.** The following MUST NOT be persisted server-side: span offsets or lengths,
  real filenames, and any document text or surrounding context. Filenames are stored as
  a hash or a user-supplied label.
- **FR1.4.** Degraded-mode frequency MUST be reportable from FR1.1 data, closing Redact
  4's open question about whether its FR2 warning is adequate.

### FR2: Retention and aggregation

- **FR2.1.** Three retention clocks MUST be configured independently: audit and
  attestation records, user activity telemetry, and the local diagnostic store.
  Proposed values are in the design record.
- **FR2.2.** At the end of the telemetry window, records MUST be aggregated to counts
  from which no individual can be singled out, and the underlying rows deleted.
  Hashing an identifier is not anonymisation and MUST NOT be used to justify indefinite
  retention.
- **FR2.3.** No long-term aggregate MAY be retained for a group of fewer than five
  contributing users. The aggregation job enforces this; it is not a policy note.
- **FR2.4.** Per-organisation aggregate granularity MAY be configured within the
  telemetry window for the supervision view. The FR2.3 threshold is not configurable,
  because the personal data belongs to the solicitor rather than the firm.

### FR3: Processing mode is explicit and enforceable

Both web and desktop remain full-featured. That decision obliges the controls below;
without them the privacy guarantee diverges while the interface does not, and a user
cannot tell which one they have.

- **FR3.1.** The active processing mode MUST be visible in application chrome at all
  times, not shown once at run creation.
- **FR3.2.** The audit export MUST state where processing occurred.
- **FR3.3.** An organisation MUST be able to require local-only processing, and **the
  API MUST refuse hosted runs for such organisations.** A control enforced only by
  hiding UI is not a control.

### FR4: Attestation

- **FR4.1.** Input and output documents MUST be hashed client-side, with only the
  hashes transmitted.
- **FR4.2.** Hashes MUST appear in the audit export, so a firm can demonstrate that a
  given file is the one processed.
- **FR4.3.** This MUST land before or with FR5, because audit records created without
  it cannot be retrofitted.

### FR5: Local processing

- **FR5.1.** DOCX, text-layer PDF and TXT extraction MUST run in the Electron main
  process.
- **FR5.2.** Model weights MUST be bundled in the installer, not fetched at first run.
  Air-gapped installation MUST work.
- **FR5.3.** Shared review components MUST reach data through an injected port, not by
  calling transport directly, so the same UI serves `apiFetch` and Electron IPC.
- **FR5.4.** The hosted path MUST record the same content-free fields as the local
  path, so the audit artefact is uniform across modes.

### FR6: Diagnostics

- **FR6.1.** Run detail MUST be retained locally, encrypted at rest, expiring per
  FR2.1.
- **FR6.2.** Nothing transmits without an affirmative user action. On report, the
  application MUST show the exact payload before sending.
- **FR6.3.** The payload MUST be a bounded window around the reported miss, not the
  document.
- **FR6.4.** Local flagging heuristics (low OCR confidence where applicable, model and
  supplement disagreement, span density anomaly, high manual-addition count) MUST
  surface as content-free metrics.

## Non-Functional Requirements

- Desktop forced update. The application does not run on an outdated version, framed
  and documented as a security control.
- Detection latency MUST NOT regress against delivered targets.
- Configuration read once at startup, consistent with Redact 4 FR4.
- Retention periods MUST appear in the privacy notice.

## Gates

**Gate 1: Telemetry and retention.** FR1, FR2. No architecture change, no local
processing. Delivers the quality signal, answers Redact 4's open question, and
establishes the retention job before there is a volume of data to migrate.
_Exit:_ degraded-mode frequency is reportable; the aggregation job runs and enforces
the group-size threshold; retention periods are documented and in the privacy notice.

**Gate 2: Attestation.** FR4. Small, independent, and must precede Gate 3 so audit
records are uniform from the first local run.
_Exit:_ input and output hashes appear in the audit export for hosted runs.

**Gate 3: Local processing and mode enforcement.** FR3, FR5. These ship together. Local
processing without the mode controls creates the trust ambiguity FR3 exists to prevent.
_Exit:_ a desktop run completes with no document content leaving the machine; an
organisation set to local-only receives a refusal from the API on a hosted run attempt.

**Gate 4: Diagnostics.** FR6.
_Exit:_ a user can report a missed detection, preview the exact payload, and send it;
flagged runs surface without content.

## Risks

- **Gate 3 is larger than it looks.** FR5.3 is a refactor of how shared review
  components obtain data, not a new feature. Scope it before committing to a date.
- **The escrow question returns.** If local diagnostic retention proves insufficient,
  the fallback is client-side encryption under a firm-held key, which carries real
  key-management cost. Related: the same problem appears unavoidably in
  [`mobile-capture.md`](../specs/redact/mobile-capture.md) and should be solved once.
- **Marketing overreach.** "Never leaves your machine" is true of desktop and false of
  web. The accurate claim is that local processing is available and enforceable at
  organisation level.
- Small firms are a large share of the market, so FR2.3 will routinely force cross-org
  aggregation. If per-firm long-term reporting turns out to be a sales requirement,
  that conflicts with FR2.3 and needs resolving in favour of FR2.3.

## Open Questions

- Retention period for audit and attestation records. Six years matches the general
  limitation period and firm practice, but latent damage provisions can extend
  professional negligence exposure well beyond it.
- Whether the firm-level supervision view ships in Gate 1 or later. Firms have
  supervision duties and will want it, but a partner seeing which associate redacted
  what is a workplace monitoring surface and should be deliberate.
- Encryption scheme for the local diagnostic store.
- Whether Redact 4's second open question (degraded runs finalizable under
  `external_sharing`) should be answered by Gate 1 data before Gate 3 begins.
