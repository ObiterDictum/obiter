# Redact 4: Detection Integrity and Hardening

Status: active. Carries forward the outstanding items from [Redact 1](archive/redact-1-detection.md), [Redact 2](archive/redact-2-review-output.md) and [Redact 3](archive/redact-3-production.md), all now delivered and archived.

## Summary

Redact works. Detection, review, decisions, output, audit export, synthetic data and dataset export all shipped and are covered by passing tests. This PRD is not a rebuild; it closes a small number of specific gaps found when the three delivered PRDs were validated against the code on 2026-07-27.

One of those gaps is a trust defect rather than a missing feature, and it is the reason this document exists.

## Validation Baseline

Verified 2026-07-27 against `dev`:

| Package                     | Result               |
| --------------------------- | -------------------- |
| `@obiter/redaction-policy`  | 50 tests pass        |
| `@obiter/redact-ui`         | 6 tests pass         |
| `@obiter/rampart-inference` | 2 tests pass         |
| `@obiter/api`               | 240 pass, 14 skipped |
| Typecheck, all four         | clean                |

Structural checks confirmed: migration `0005_redaction.sql` and successors; all eight contract schemas; all six error codes; every `redaction-policy` module; all API routes including `/spans/:spanId/decision`, `/finalize` and `/audit`; `document-extraction.ts`; `redaction-audit-report.ts` with JSON, Markdown and HTML renderers; `generate-synthetic-data.ts`, `scripts/synthetic-v2/` and `export-training-data.ts`.

## Problem

### Degraded detection is invisible to the reviewer

When the Rampart model fails to load or inference errors, detection does not fail. It completes the run using deterministic heuristics plus the UK supplement, and records `mode=heuristics+supplement` inside the `detectorVersion` string.

That fallback is recorded server-side and the `detectorVersion` field reaches `packages/redact-ui/src/types.ts` and the API response. It is never rendered. No reference to degraded state, detection mode or detector version appears in `review.tsx` or `runs.tsx`.

The consequence is that a reviewer can open a run, work through the spans, and finalize a document believing a trained model found the personal data in it, when only regular expressions ran. Heuristics do not detect names, addresses or contextual dates of birth. Those are exactly the categories the model exists to catch.

This is the failure mode the product exists to prevent: a document leaving a firm with personal data in it, with an audit trail saying it was reviewed.

It also contradicts two things already written down. [Redact 1](archive/redact-1-detection.md) F6 requires a model load failure to throw a typed error that the route maps to `redaction_detection_failed`; the shipped behaviour degrades instead. And the repository principle in `README.md` states that legal-critical failures should be visible rather than hidden behind quiet fallbacks.

The choice to degrade rather than fail is defensible on its own: a partial result a reviewer can work with may beat a hard error. The defect is that the reviewer is not told.

### Detection is not configurable

[Redact 1](archive/redact-1-detection.md) F30 requires the model id, minimum confidence score and chunk size to be environment-configurable. None is. `REDACT_MODEL_ID`, `REDACT_MIN_SCORE` and `REDACT_CHUNK_TOKENS` do not exist in the codebase.

The values themselves are correct and deliberate: `minScore` defaults to `0.4` and `chunkText` to `400` tokens, both matching the PRD. The model id is a hardcoded `RAMPART_MODEL_ID = 'qarlus/rampart'`, which is the pinned mirror described in `NOTICE`, so the value is intentional even though it differs from the PRD's stated default.

This matters for tuning detection recall without a deploy, and for pointing a test environment at a different model revision.

### Three acceptance criteria were never verified

[Redact 3](archive/redact-3-production.md) acceptance criteria 5, 7 and 8 require running things rather than inspecting them, and were not confirmed during validation.

## Goals

- A reviewer always knows which detector produced the spans they are reviewing.
- Degraded detection is a deliberate, visible state rather than an implementation detail in a version string.
- Detection parameters are tunable without a code change.
- Every acceptance criterion from the delivered PRDs is confirmed rather than assumed.

## Non-Goals

- Rebuilding or re-architecting detection, review, output or audit. They work.
- Changing the span categories, the merge rules or the suggestion defaults.
- Desktop-local inference.
- OCR for scanned PDFs.
- Revisiting the Effect TS pilot, which is closed. See [Redact 1](archive/redact-1-detection.md).

## Functional Requirements

### FR1: Degraded detection is a first-class field

- **FR1.1.** The redaction run record MUST expose detection mode as a structured field, not only as a substring of `detectorVersion`. Parsing a version string to determine whether a document was safely redacted is not an acceptable interface.
- **FR1.2.** The field MUST be present in `packages/contracts`, persisted on the run, and returned by `GET /api/redaction-runs/:runId` and the document run list.
- **FR1.3.** The audit report MUST record the detection mode for the run, so an exported report is self-describing about what produced its spans.
- **FR1.4.** Historical rows without explicit model or degraded provenance MUST use `unknown`. The product MUST describe that absence of provenance truthfully rather than claiming model detection did not run.

### FR2: Degraded detection is visible in review

- **FR2.1.** The review UI MUST display a persistent, non-dismissible warning when a run was produced in degraded mode, stating plainly that model-based detection did not run and that names, addresses and dates of birth were not automatically detected.
- **FR2.2.** The warning MUST be visible at the point of finalizing, not only on entry to the run, so it cannot be scrolled past and forgotten.
- **FR2.3.** The run list MUST mark degraded runs, so a supervisor reviewing several runs can see which are affected without opening each.
- **FR2.4.** Finalizing a degraded run MUST require explicit acknowledgement that model detection did not run. A run with unknown provenance MUST require a distinct acknowledgement that its detection mode was not recorded. The reviewer may proceed; they may not proceed unaware.
- **FR2.5.** A degraded or unknown run MUST offer model re-detection from the exact stored source. Successful re-detection creates one fresh, linked run with empty decisions and leaves the original run and its history unchanged. If the model is still unavailable, no replacement run or source object is created.

### FR3: Reconcile the failure contract

- **FR3.1.** Degrade rather than fail is the intended contract for model load, inference and recoverable post-inference processing failures. The detector MUST discard unusable model output, complete with heuristics and the UK supplement, persist `heuristics+supplement` as its structured mode, and require the visibility and acknowledgement controls in FR1 and FR2. This supersedes [Redact 1](archive/redact-1-detection.md) F6.
- **FR3.2.** A partial result the reviewer can act on is preferable to a hard failure only when the degraded state is explicit. The detector version remains provenance and MUST NOT be parsed by callers to discover this state.
- **FR3.3.** `redaction_detection_failed` remains the 500 surface for internal detection pipeline failures that are not recoverable by degrading. Corrupt or unreadable uploads are client input and remain `validation_failed` responses with status 400.

### FR4: Detection configuration

- **FR4.1.** `REDACT_MODEL_ID` MUST configure the model id, defaulting to the pinned `qarlus/rampart` mirror.
- **FR4.2.** `REDACT_MIN_SCORE` MUST configure the minimum confidence score, defaulting to `0.4`.
- **FR4.3.** `REDACT_CHUNK_TOKENS` MUST configure chunk size, defaulting to `400`.
- **FR4.4.** Invalid values MUST fail at startup with a clear message rather than silently falling back to defaults. A misconfigured confidence threshold changes what is detected, so it must not fail quietly.

### FR5: Confirm the unverified acceptance criteria

- **FR5.1.** Confirm the synthetic data generator produces at least 200 valid, validated JSONL documents across 7 or more types.
- **FR5.2.** Confirm the demo fixture runs end to end without errors.
- **FR5.3.** Confirm every case in the [Redact 3](archive/redact-3-production.md) edge case table passes.
- **FR5.4.** Where confirmation requires a manual run, add an automated check so the criterion stays true rather than being true once.

### FR6: Correct the stale specifications

Validation found documentation that contradicts the code. These are corrected as part of this work because they actively mislead.

- **FR6.1.** `docs/specs/redact/build-plan.md` states the Rampart pipeline is "NOT YET IMPLEMENTED" and that detection runs the supplement only. It shipped. Correct it.
- **FR6.2.** `docs/specs/redact/milestones.md` states model integration is "planned but not shipped". Correct it.
- **FR6.3.** `docs/architecture.md` describes the Redact detection module as a contained Effect pilot behind a promise facade. No module imports `effect`. Correct it to record the pilot as abandoned, which is the evidence-based answer its own decision gate called for.

## Non-Functional Requirements

- No regression in detection latency. The delivered targets stand.
- The degraded-mode warning must not require a new request; the information is already on the run record.
- Persistent detection warnings use note semantics. The finalisation-point warning is the single assertive live region when the dialog opens.
- Re-detection is idempotent for each source run and does not hold a database transaction open during model inference.
- Configuration is read once at startup, not per request.

## Security And Compliance

- The detection mode and any source-to-replacement run relationship are part of the audit trail. A finalized document must be traceable to what detected its spans.
- A standalone replacement receives its own organisation-scoped source object. A document-linked replacement continues to reference the exact immutable document version used by the source run.
- Object keys, prompts and logs continue to exclude client names, matter names and raw legal text.

## Rollout

**Gate 1: Visibility.** FR1, FR2, FR3. The trust defect closes here and this is the only part that is urgent.
_Exit:_ a reviewer cannot finalize a degraded or unknown-provenance run without truthful warning and acknowledgement; detection mode is structured on the run and in the audit report, and successful model re-detection creates a linked replacement without changing the original.

**Gate 2: Configuration and confirmation.** FR4, FR5, FR6.
_Exit:_ detection parameters are environment-configurable with startup validation; all delivered acceptance criteria are confirmed by automated checks; no specification contradicts the code.

## Risks

- Degraded mode may be more common than assumed. If the model fails to load routinely, FR2 turns into a warning users learn to dismiss mentally. Worth measuring how often degradation actually occurs before deciding the warning is sufficient.
- Re-detection can report that the model remains unavailable. The original run remains reviewable, no replacement is created, and the reviewer must try again later or continue with explicit acknowledgement.
- Making the model id configurable invites pointing production at an unpinned model. FR4.4's startup validation is the control; consider whether the id should be restricted to an allowlist.

## Open Questions

- How often does degraded mode actually trigger in practice? This determines whether FR2 is adequate or whether degraded runs should be blocked from finalizing entirely.
- Should a degraded run be finalizable at all for `external_sharing` policy mode, given that is the mode where undetected personal data leaves the firm?
