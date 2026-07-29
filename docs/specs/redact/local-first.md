# Redact Local-First Architecture

Status: design record. **Scheduled as [Redact PRD 5](../../prds/redact-5-local-first.md)**,
which carries the requirements and gates. This document is the reasoning behind them.
Date: 2026-07-29
Supersedes: the deferral note at `build-plan.md` line 165 ("desktop-local redaction is M3+ scope")

## Principle

Documents are processed on the user's machine. The server never receives document
content, extracted text, or span positions. What the server holds is content-free
run metadata plus cryptographic hashes, which together are sufficient for audit and
attestation without disclosure.

This is a product position, not only an implementation preference. "Your client's
privileged material never leaves your machine" is the differentiator against every
cloud redaction vendor, and it removes the processor relationship that would
otherwise dominate procurement.

## Why this is now feasible

`@obiter/rampart-inference` has exactly one dependency, `@huggingface/transformers`.
No database, no HTTP framework. The model is 18.5M parameters in a 14.7 MB ONNX file
(MiniLM-L6-H384, 35-label BIO head) running at ~6.6 ms p50 on CPU. It runs unchanged
in Electron main, in a renderer, or in a browser tab.

`apps/desktop` already exists as a working electron-vite / electron-builder
application producing a Windows installer. `syncState: 'local_only'` is already in
the contract schema.

The detection engine is therefore not the blocker.

## What has to move

### 1. Text extraction

Currently server-side (`milestones.md` M3: "extract server-side text"). This is what
actually forces the upload, not detection. Moving it into the Electron main process
means mammoth for DOCX and pdf.js for text-layer PDF, both pure Node.

**The contract freeze does not block this** (checked 2026-07-29). The freeze artifact
is `docs/specs/app-shell/contract.md`, and its scope is the UI surface: `@obiter/ui`
primitive exports, `--obiter-*` design tokens, `@obiter/app-shell` exports
(`useCurrentUser`, `apiFetch`, `QueryClient`, auth client), TanStack front-end route
paths, `PageScaffold`, and the app frame. Section 4 "Routes" refers to file-routing
paths, not API endpoints. Moving extraction into Electron main is a runtime change
and touches none of it.

Two real couplings exist instead:

- **`@obiter/contracts`.** The Redact UI imports it, and document/upload schema
  changes ripple. Not frozen by `contract.md`, but shared across both tracks.
- **The shared review UI.** `build-plan.md` line 452 has the review components
  shared between web and desktop. This is the genuine architectural work, and it is
  larger than the extraction move itself. See "Web and desktop divergence" below.

## Web and desktop divergence

The shared review UI was a straightforward win while both surfaces talked to the same
API. Local-first breaks that assumption, and the consequences are not only technical.

**The serious problem is that the privacy guarantee diverges while the interface does
not.** On desktop the document never leaves the machine. On web it goes to the
server. Same components, same screens, materially different guarantee. A solicitor
will not track which one they are in, and one who believes they have local-first
protection while using the web app is a trust failure worse than never having offered
local processing.

**Decided (2026-07-29): both surfaces stay full-featured.** Web keeps redaction rather
than dropping it or degrading to read-only. That preserves reach, and it obliges two
things that are not optional if the trust claim is to survive:

1. **Persistent mode indication.** Which processing mode is active must be visible in
   the application chrome at all times, not shown once at run creation and then
   forgotten. It also belongs on the audit export, so the record states where
   processing happened.
2. **Organisation policy enforced server-side.** Firms that require local-only
   processing must be able to set that at organisation level, and **the API must
   refuse hosted runs for those organisations.** A policy that only hides the button
   in the web UI is not a control; it is a suggestion. This is the difference between
   something a firm's IT can rely on and something they cannot.

Because both surfaces persist, the marketing claim needs stating precisely. "Never
leaves your machine" is true of the desktop application and false of the web one, so
the accurate framing is that local processing is available and enforceable at
organisation level, not that it is universal.

The remaining issues follow from dual support:

- **Two data sources behind one component tree.** Web calls `apiFetch`; desktop needs
  IPC to Electron main. Shared components must not know which. That means a data
  access port injected at the application boundary rather than components reaching
  for transport directly.
- **Capability divergence.** Desktop gets local file access and offline operation;
  web gets zero install and is always current. Serving both from one UI means either
  building to the lowest common denominator or introducing conditional capability in
  shared components, which is the drift `contract.md` exists to prevent.
- **Audit fidelity.** `GET /api/redaction-runs/:runId/audit` would otherwise return
  richer records for hosted runs than local ones. **Resolution: make the hosted path
  record exactly the same content-free fields as the local path.** Nothing of value is
  lost, the audit artefact becomes uniform, and the difference stops being visible in
  the evidence a firm relies on.
- **Version skew.** Forced update narrows but does not eliminate the window where a
  desktop client meets a newer API.
- **Test surface doubles.** Every review flow acquires a second runtime.

### 2. Model weights

Currently fetched from HuggingFace on first use and cached to disk. For a local-first
product this is wrong: it prevents air-gapped installation and creates a first-run
dependency on a third party. Weights (14.7 MB) are vendored into the installer.

## Update policy

**Desktop: forced update.** The application will not run on an outdated version. This
is framed and documented as a security control, which is both true and an easy sell
to a firm handling privileged material.

**Web: updates on deploy.** No user-side version control exists, so no policy needed.

Forced update resolves version skew. It does *not* resolve defect detection: everyone
runs the same model, but nobody sees which documents it failed on. That is handled
by the diagnostics design below, and it is the reason that design is load-bearing
rather than a nicety.

## Server-side audit trail

### Synced (content-free)

- Run identifier, opaque document identifier, timestamps, duration
- User identifier, organisation identifier
- Model version, policy version, engine mode (`model+supplement` /
  `heuristics+supplement`)
- Span counts by category and by source (`rampart_model`, `rampart_deterministic`,
  `uk_supplement`)
- Document page count and byte size
- Outcome status
- OCR confidence distribution, where OCR ran
- **Reviewer actions: accepted, rejected and manually added span counts, per
  category**

### Never synced

- **Span offsets.** Character positions and lengths are a structural fingerprint of
  the document, and span length alone leaks name length.
- **Real filenames.** "Smith v Jones witness statement.docx" discloses more than the
  redaction protected. Store a hash, or a user-supplied label.
- **Any document text**, including surrounding context.

### Reviewer actions are the quality signal

Rejections give the false-positive rate. Manual additions give the false-negative
rate. Both per category, both entirely content-free.

Because the local-first design makes us blind to documents by construction, this is
the highest-value telemetry available to us, and it should be treated as a
first-class part of the schema rather than derived later.

## Attestation by hash

A usage log records that *a* run occurred with certain characteristics. It cannot
demonstrate that *this specific file* was correctly redacted, which is the claim a
firm will need when asked to prove disclosure was handled properly.

Resolution: hash the input and output documents client-side, sync only the hashes.
The firm can then prove a given file is the one that was processed, and we can
corroborate it, while holding nothing readable.

Cost is two hash operations. This should be built in from the start rather than
retrofitted, because retrofitting invalidates every audit record created before it.

## Diagnostics and failure reporting

### Rejected approach

Storing run detail server-side under a policy of only inspecting it when flagged.
This is a policy control, not a technical one. Once we hold the document it is
discoverable by court order or warrant, we become a processor holding privileged
material under UK GDPR, a breach of our storage is a breach of their client's data,
and the local-first claim becomes false.

### Adopted approach

**Local retention, consent-gated transfer.**

- Run detail stays on the user's machine, encrypted at rest, with a retention window
  that expires on its own (proposed: 30 days).
- Nothing transmits by default. On a user report, the application requests approval
  to send that specific bundle.
- Absent a report, the data expires on their disk. We never held it.

**Minimal, previewed payload.** Diagnosing a missed detection needs the text around
the miss, not the file. The user marks what was missed, the application extracts a
window of a few hundred characters, and then shows them the exact payload before
sending. That preview is what makes the flow defensible: a solicitor can confirm by
inspection that it contains nothing they cannot share.

### Local flagging

We do not have to wait for complaints. These are computed locally and content-free,
so the *flag* syncs as a metric while the *content* does not:

- OCR page confidence below threshold
- Model and supplement disagreeing sharply
- Span density out of line with document length
- Unusually high manual-addition count during review

This gives a proactive signal and lets us request diagnostics on the runs most likely
to be broken. It relates to the degraded-mode surfacing work in
[Redact PRD 4](../../prds/redact-4-hardening.md), which currently does not surface
`heuristics+supplement` fallback to reviewers.

### Escrow fallback

If local retention proves insufficient in practice (users no longer have the machine
when asked), the honest version of server-side storage is client-side encryption
under a firm-held key. We store ciphertext we cannot read; they supply the key when
reporting. That is "store but cannot look" enforced by mathematics rather than
promise.

Held in reserve. It carries real key-management cost, so it should not be adopted
pre-emptively. See `mobile-capture.md`, where the same key-management problem arises
unavoidably.

## Retention

Article 5(1)(e) sets no period. It requires that one be *defined*, or that the
criteria determining it be defined, and stated in the privacy notice. "As long as
required" is the standard, not a policy. Three clocks, not one:

| Record | Proposed | Basis |
|---|---|---|
| Audit and attestation (document hashes, content-free run metadata) | 6 years from run | Aligns with the general limitation period and with the retention firms already apply to matter files. Evidential purpose. Lawful basis: contract and legal obligation |
| User activity telemetry (who ran what, when) | 12 to 24 months | Personal data about the solicitor with weak justification for longer. Lawful basis: legitimate interests, needs an assessment |
| Local diagnostic store | 30 days | Never leaves the device unless reported |

Latent damage provisions can extend professional negligence exposure well past six
years, so the audit clock may warrant a longer period for some matter types. That is
a decision for the firm-facing retention policy rather than a platform default.

### Hashing does not buy indefinite retention

Hashing a user or organisation identifier produces pseudonymous data, not anonymous
data, and pseudonymous data remains personal data. Identifier spaces are low entropy
and enumerable, so a hash of an email or a user id is reversible by brute force, and
any retained mapping makes it trivially reversible. Retaining hashed user rows
indefinitely is retaining personal data indefinitely.

**What does work is aggregation, not hashing.** At the end of the telemetry period,
roll rows up to counts from which no individual can be singled out, and discard the
underlying records. "In March 2027, 412 runs produced 3,201 person_name spans and 47
manual additions" carries no identifier and can be kept indefinitely.

The trap is small organisations: an org-level aggregate where the org has two users
can still single out an individual. **Proposed rule: no long-term aggregate is
retained for a group smaller than five contributing users.** Below that threshold,
either roll the figures up across organisations or discard them with the underlying
rows. Small firms are a large share of the market, so this will bite in practice and
should be enforced in the aggregation job rather than left to policy.

**Per-organisation aggregate views are fine, and are a separate thing.** During the
telemetry retention window an organisation can see its own users' activity; that is
the supervision view, and its lawful basis is the firm's supervisory interest. The
group-size threshold governs only what survives *past* the window as indefinitely
retained data. The distinction matters because the personal data in question belongs
to the solicitor, not to the firm, so an organisation cannot elect a lower threshold
on its employees' behalf. Granularity is configurable per organisation inside the
window; the indefinite-retention threshold is not.

**Document hashes are a separate case.** They are hashes of documents, not of people,
and retaining them long term is the entire point of the attestation design.

## Accepted losses

- A user's machine failing before they report means that diagnostic is gone.
- Small-N count disclosure: "1 passport, 1 person_name, 2 pages" is close to
  identifying in context. Accepted knowingly.

## Open items

- How the shared web/desktop review UI abstracts over local vs hosted data sources
- Confirm the retention periods below and carry them into the privacy notice
- Whether the firm-level supervision view ships early or later. Firms have
  supervision duties and will want it, but a partner seeing which associate redacted
  what and when is a workplace monitoring surface and should be deliberate
- Encryption scheme and key handling for the local diagnostic store
