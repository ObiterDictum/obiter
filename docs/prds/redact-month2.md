# Redact Month 2: Review, Decisions, and Output Generation

## Summary

Month 2 builds the human review layer on top of Month 1's detection pipeline. After detection runs and spans are stored, reviewers need to examine every detected span, make a decision (accept, reject, override, or pseudonymise), and produce a final output artifact. This month delivers the span decisions API, the output generation engine (redacted and pseudonymised modes), the finalize flow, a complete review UI, artifact storage integration, and audit logging for all redaction actions.

By the end of Month 2, a user can:
1. Create a redaction run and see its detected spans (built in [Month 1](redact-month1.md))
2. Review each span in the UI, sorted and filtered by category or source
3. Submit accept/reject/override/pseudonymise decisions on individual spans
4. Finalize the run, producing either a redacted document (`[REDACTED]` replacements) or a pseudonymised document (consistent `[CATEGORY_N]` tokens)
5. View and download the output artifact
6. Trace every decision in the audit log

See the detailed implementation at [docs/specs/redact/build-plan.md](../specs/redact/build-plan.md).

## Problem

A redaction pipeline that only detects spans is not a product. Detection is the first step; without human review and decision-making, the output cannot be trusted for legal use. Law firms need to:

- **Review every span**: automated detection is never perfect. False positives (flagging non-sensitive text) and false negatives (missing sensitive text) both have legal consequences.
- **Choose output mode**: some recipients need fully redacted text (no PII visible at all), others need pseudonymised text (consistent tokens so the document is still readable).
- **Maintain audit trail**: every decision must be traceable to a reviewer, at a specific time, for compliance and client protection.
- **Handle edge cases**: overlapping spans, spans from different detection sources, un-reviewed spans, and re-running redaction on the same document.

Without Month 2, the product has detection but no delivery — spans exist but cannot be acted on, and no useful output is produced.

## Product Principles

- **Human-in-the-loop**: no automated redaction is applied without human review of every span.
- **Every decision is auditable**: accept, reject, override, and pseudonymise decisions are recorded with reviewer identity and timestamp.
- **Output is irreversible**: redacted output replaces spans with `[REDACTED]` — original text is not recoverable from the output artifact. Pseudonymised output preserves readability but requires the token map for re-identification.
- **Consistency matters**: pseudonymisation must use the same token for the same entity across the entire document.
- **Detection source transparency**: the UI must distinguish Privacy Filter spans from regex supplement spans so reviewers can calibrate trust by source.
- **Warn, don't block**: reviewers may finalize a run with un-reviewed spans, but the system warns that un-reviewed spans exist.

## Goals

- Reviewers can submit decisions on individual spans via API and UI.
- Output generation produces correct redacted and pseudonymised text.
- Finalize flow stores output as a durable artifact with correct object key path.
- Review UI supports sorting, filtering, and bulk review patterns.
- All redaction actions are logged in the audit log.
- TanStack Query hooks provide server state management for the review UI.
- Sidebar navigation links to the redaction review route.

## Non-Goals

- No automated/ML-assisted decision suggestions (Month 3 or later).
- No batch decision-making for categories or sources (future).
- No DOCX extraction or non-text document handling (Month 3).
- No desktop-local redaction (Month 3+).
- No redaction report export as PDF/HTML audit artifact (Month 3).
- No re-detection or edit detection parameters after run creation (future).

## Users

### Reviewing Lawyer

The primary user. Opens a redaction run, reviews detected spans in context of the original document text, and makes a decision on each span. Needs clear visual distinction between detection sources, confidence indicators, and the ability to see the full document text with highlighted spans.

### Matter Supervisor

Oversees redaction quality. Can view audit logs of decisions, verify that all spans were reviewed, and download final output artifacts. May re-run redaction if the initial detection was insufficient.

### Compliance Officer

Needs the audit trail for regulatory review. Inspects decision records, timestamps, reviewer identity, and output artifacts to confirm proper handling of sensitive data.

## Core Use Cases

1. **Review detected spans**: Open a redaction run ready for review. See all detected spans highlighted in the document text. Distinguish between Privacy Filter (AI model) and regex supplement (UK legal patterns) detections.

2. **Make a decision on a span**: Click a span in the document or select it from the list. Choose accept (use the suggested redaction), reject (keep the original text), override to redact (force redact even if model suggested keep), override to keep (force keep even if model suggested redact), or pseudonymise (replace with a category token).

3. **Sort and filter spans**: Sort the span list by category, confidence, detection source, or review status. Filter to show only unreviewed spans, or only spans from a specific category or source.

4. **Finalize a run**: After reviewing the desired spans, select output mode (redacted or pseudonymised) and finalize. The system applies all decisions, generates the output text, stores it as an artifact, and marks the run as finalized.

5. **View and download output**: Access the finalized artifact from the run detail view. Download or inspect the redacted or pseudonymised document.

6. **Inspect audit trail**: View decision history for a run, including who decided what and when.

## Scope

Month 2 covers four areas:

### 1. Span Decisions API

- `POST /api/redaction-runs/:runId/spans/:spanId/decision` — submit a decision for a single span
- Decision types: `accept`, `reject`, `override_redact`, `override_keep`, `pseudonymise`
- Decisions stored in `decisions_json` keyed by span id
- Auto-transition run status from `ready_for_review` to `reviewing` on first decision
- Validation: span must exist in the run, run must not be finalized, run must not be in `pending` or `detecting` state
- Returns the updated run with decisions and summary

### 2. Output Generation (`packages/redaction-policy/src/apply.ts`)

- `applyRedacted(text, spans, decisions)` — replaces affected spans with `[REDACTED]`
- `applyPseudonymised(text, spans, decisions)` — replaces affected spans with `[CATEGORY_N]` tokens
- Pseudonymisation consistency: same entity text within the same category gets the same token across the entire document
- Token map per run: e.g. `[PERSON_1]` = "James Cartwright", `[PERSON_2]` = "Sarah Jones"
- Only spans with `accept`, `override_redact`, or `pseudonymise` decisions are affected
- Spans with `reject` or `override_keep` decisions are left as-is
- Undecided spans are left as-is (no automated redaction without review)
- Pure functions, no side effects, testable in isolation

### 3. Finalize API

- `POST /api/redaction-runs/:runId/finalize` with body `{ outputMode: 'redacted' | 'pseudonymised' }`
- Loads extracted text from `document_versions.text_object_key`
- Applies decisions using `apply.ts` functions
- Stores output text in object storage
- Creates `artifacts` row with type `redaction_report`
- Updates run status to `finalized`, sets `output_artifact_id`
- Writes audit log entry `redaction.finalize`
- Validation: cannot finalize a run in `pending` or `detecting` state (error: `redaction_run_not_reviewable`)
- Validation: cannot finalize an already-finalized run (error: `redaction_already_finalized`)
- Warning (not block) if any spans remain un-reviewed — returned in response body as `unreviewedSpanIds: string[]`
- If object storage upload is not yet wired, falls back to local filesystem storage (documented as tech debt)

### 4. Review UI (`packages/app-shell/src/redact/`)

- Document text view with highlighted spans (color by category)
- Visual distinction between Privacy Filter spans and regex supplement spans (border style or icon)
- Span list panel: sortable by category, confidence, source, review status
- Click span -> highlight in document view, show decision buttons
- Decision action buttons: accept, reject, override redact, override keep, pseudonymise
- Summary bar: X spans total, Y reviewed, Z unreviewed, breakdown by source (Privacy Filter vs regex supplement)
- Policy mode selector on run creation (already in Month 1 API; UI shows current mode and its meaning)
- Finalize button with output mode selector (redacted vs pseudonymised)
- TanStack Query hooks: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- Route: `/matters/:matterId/documents/:documentId/redact/:runId`
- Sidebar: change "Redaction" entry from `status: 'planned'` to active link with `to` attribute
- Empty states: no runs yet for this document, no spans detected (run completed with zero spans), all spans reviewed
- Loading states: detection in progress (polling worker), finalizing
- No `useEffect` for data fetching (repo convention — use TanStack Query)

## Data Model Decisions

### Decoupled Output Storage

The redacted/pseudonymised output is stored as an `artifacts` row with type `redaction_report`. The `object_key` follows the existing pattern:

```
org/{org_id}/matters/{matter_id}/artifacts/{artifact_id}
```

The artifact references `document_version_id` to trace back to the source document version. The run's `output_artifact_id` provides the link from the run to its output.

### Object Storage Integration

The existing codebase stores document content via object upload in document version creation (`object_key`). The text extraction path (`text_object_key`) stores extracted text in object storage. The artifacts table already has `object_key` with a constraint ensuring the path pattern.

For Month 2, the finalize API needs to:
1. Read extracted text from object storage at `document_versions.text_object_key`
2. Write the output text to object storage at the artifact's `object_key` path

If object storage upload is not yet wired as a reusable service, the fallback is to store output as a local file and write the path into `object_key`. This is documented as tech debt to be resolved in Month 3.

### Pseudonymisation Token Map

The token map is computed during finalization and stored in the run's `summary_json` under a `tokenMap` key:

```json
{
  "tokenMap": {
    "PERSON_1": "James Cartwright",
    "PERSON_2": "Sarah Jones",
    "ORGANISATION_NAME_1": "ACME Corp"
  },
  ...existing summary fields
}
```

This enables verification of pseudonymised output and re-identification if needed (limited to authorised users). The token map follows the pattern `{CATEGORY}_{N}` with uppercase category names.

## Functional Requirements

### FR1: Span Decision Submission

```
POST /api/redaction-runs/:runId/spans/:spanId/decision
Content-Type: application/json

{
  "decision": "accept" | "reject" | "override_redact" | "override_keep" | "pseudonymise"
}

Response 200:
{
  "run": {
    "id": "red_...",
    "status": "reviewing" | "ready_for_review",
    "decisions": { ... },
    "summary": { ... }
  }
}

Errors:
- 404: run not found, span not found
- 400: invalid decision type, run not in reviewable state
- 409: run already finalized
```
- Decision body is validated against `spanDecisionSchema`
- `spanId` must exist in the run's `spans_json` array
- If run status is `ready_for_review` and this is the first decision, auto-transition to `reviewing`
- Audit log `redaction.span_decision` with metadata: `{ spanId, decision, category }`
- Previous decisions can be overwritten (re-decide a span)

### FR2: Output Generation Functions

```
applyRedacted(text: string, spans: RedactionSpan[], decisions: Decisions): string
applyPseudonymised(text: string, spans: RedactionSpan[], decisions: Decisions): string
```

- `applyRedacted`: For each span with decision `accept` or `override_redact`, replace `text.slice(span.start, span.end)` with `[REDACTED]`. Process spans in reverse order of `start` to preserve character offsets. Spans with `pseudonymise` decision are also replaced with `[REDACTED]` in redacted mode (pseudonymisation is a privacy choice, but in redacted mode everything becomes `[REDACTED]`).

- `applyPseudonymised`: For each span with decision `accept`, `override_redact`, or `pseudonymise`, replace with `[CATEGORY_N]` where `CATEGORY` is the uppercase category label and `N` is a sequential integer unique to that category in the document. The same entity text within the same category always gets the same `N`. Pass `applyRedacted`'s decision for consistency (accept/override_redact/pseudonymise all result in token replacement in pseudonymised mode; reject/override_keep leave text as-is).

- Handle overlapping spans: if a higher-confidence span (Privacy Filter) overlaps a lower-confidence span (regex supplement), and both have decisions that affect output, the higher-confidence span's replacement takes priority.

- Edge cases:
  - Empty text: return empty string
  - No decisions: return original text
  - All spans rejected: return original text
  - Span text not found at offset (e.g. text changed): skip the span, log warning, continue

### FR3: Finalize Run

```
POST /api/redaction-runs/:runId/finalize
Content-Type: application/json

{
  "outputMode": "redacted" | "pseudonymised"
}

Response 200:
{
  "run": {
    "id": "red_...",
    "status": "finalized",
    "outputArtifactId": "art_..."
  },
  "artifact": {
    "id": "art_...",
    "objectKey": "org/{orgId}/matters/{matterId}/artifacts/{artifactId}",
    "artifactType": "redaction_report"
  },
  "warnings": {
    "unreviewedSpanIds": ["span_...", "span_..."]
  }
}

Errors:
- 404: run not found
- 400: run in pending/detecting state (redaction_run_not_reviewable),
       invalid output mode
- 409: run already finalized (redaction_already_finalized)
```

Finalize flow:
1. Validate run is in `reviewing` or `ready_for_review` status
2. Load document version's extracted text from `text_object_key` via object storage
3. Compute pseudonymisation token map if needed (for both modes, actually, since pseudonymised mode needs it and redacted mode may want the map stored for reference)
4. Apply decisions using the appropriate apply function
5. Write output text to object storage at artifact path
6. Insert `artifacts` row with type `redaction_report`, status `ready`, object_key, document_version_id
7. Update run: status = `finalized`, `output_artifact_id` = artifact id, store token map in `summary_json`
8. Write audit log: `redaction.finalize` with metadata: `{ outputMode, artifactId, spanCount: X, reviewedCount: Y, unreviewedCount: Z }`
9. Return run with artifact details and any warnings

### FR4: Summary Computation

The run summary (re-computed on every mutation) includes:

```json
{
  "totalSpans": 42,
  "byCategory": {
    "person_name": 15,
    "email": 3,
    "phone": 2,
    "address": 5,
    "date": 8,
    "account_number": 1,
    "secret": 0,
    "url": 1,
    "national_insurance": 3,
    "passport": 1,
    "case_reference": 2,
    "organisation_name": 1
  },
  "bySource": {
    "privacyFilter": 35,
    "regexSupplement": 7
  },
  "byDecision": {
    "accept": 10,
    "reject": 5,
    "override_redact": 1,
    "override_keep": 0,
    "pseudonymise": 3,
    "undecided": 23
  },
  "reviewedCount": 19,
  "unreviewedCount": 23
}
```

### FR5: Review UI — Document Text View

- Display the document's extracted text with spans highlighted
- Each span displays as an inline highlight with background color by category
- Category color mapping (Tailwind-based):
  - `person_name`: red/rose
  - `email`: amber
  - `phone`: orange
  - `address`: yellow
  - `date`: violet
  - `account_number`: pink
  - `secret`: red
  - `url`: cyan
  - `national_insurance`: teal
  - `passport`: indigo
  - `case_reference`: blue
  - `organisation_name`: purple
- Privacy Filter spans: solid underline or continuous highlight
- Regex supplement spans: dashed border or hashed highlight pattern
- Clicking a span in the text view selects it and shows the decision action bar
- Selected span scrolls into view, highlighted with a focused ring

### FR6: Review UI — Span List Panel

- Side panel listing all spans for the run
- Columns: text (truncated), category, confidence, source, status (reviewed/unreviewed), decision
- Sortable columns: category, confidence, source, status
- Filterable by: category, source, status (reviewed/unreviewed), decision type
- Clicking a span scrolls the document text view to that span and highlights it
- Keyboard navigation: arrow keys to move between spans in the list
- Span status indicators:
  - Unreviewed: grey/neutral
  - Accepted: green checkmark
  - Rejected: with strikethrough on the span text preview
  - Override redact: red with warning icon
  - Override keep: green with shield icon
  - Pseudonymised: purple with token icon

### FR7: Review UI — Decision Actions

- When a span is selected (via text view click or list click), show a decision action bar
- Action buttons (with keyboard shortcuts shown in tooltip):
  - Accept (Enter): use the span's suggested action
  - Reject (R): keep original text, do not redact
  - Override to Redact (Ctrl+R): force redaction regardless of suggestion
  - Override to Keep (Ctrl+K): force keep regardless of suggestion
  - Pseudonymise (P): replace with category token
- Action bar appears near the selected span (inline in text view) or in a floating panel
- After decision, update the span's status in both text view and list panel without full re-render
- Keyboard shortcut display: show modifier keys in the tooltip/button label

### FR8: Review UI — Summary Bar

- Top bar showing:
  - Total spans count
  - Reviewed count with progress bar (reviewed/total)
  - Unreviewed count
  - Source breakdown: X from Privacy Filter, Y from regex supplement
  - If all spans reviewed: "✓ All spans reviewed" badge with green styling
  - If no spans: "No sensitive data detected in this document"
- Summary bar is read from the run's `summary_json` field

### FR9: Review UI — Finalize Button

- "Finalize" button in the top-right of the review screen
- Disabled until at least one span decision has been made (run must be in `reviewing` state)
- On click: show a dialog/modal with:
  - Output mode selector: radio buttons for "Redacted" or "Pseudonymised"
  - Description of each mode:
    - Redacted: replaces all sensitive text with `[REDACTED]` — irreversible
    - Pseudonymised: replaces with consistent tokens like `[PERSON_1]` — readable, reversible with token map
  - If there are un-reviewed spans:
    - Warning message: "X spans have not been reviewed. Unreviewed spans will be left as-is in the output."
    - Checkbox: "I understand, proceed anyway" (must be checked to finalize)
  - "Cancel" and "Confirm Finalize" buttons
- On confirm: call `POST /api/redaction-runs/:runId/finalize` with selected `outputMode`
- Loading state: button shows spinner, disabled
- On success: redirect to run detail view showing finalized output download link
- On error: show error message (run not found, wrong state, already finalized)

### FR10: Review UI — TanStack Query Hooks

```
useRedactionRun(runId: string): UseQueryResult<RedactionRun>
useSpanDecision(runId: string): UseMutationResult<
  RedactionRun,
  Error,
  { spanId: string, decision: SpanDecision }
>
useFinalizeRun(runId: string): UseMutationResult<
  FinalizeResponse,
  Error,
  { outputMode: OutputMode }
>
```

- `useRedactionRun`: `GET /api/redaction-runs/:runId`, refetch interval of 5 seconds while run is in `detecting` status (polling for detection completion), stale time of 30 seconds once in a stable state
- `useSpanDecision`: mutation, invalidates `useRedactionRun` query key on success
- `useFinalizeRun`: mutation, invalidates `useRedactionRun` query key on success
- Query key pattern: `['redaction-run', runId]`

### FR11: Review UI — Route and Navigation

- Route: `/matters/:matterId/documents/:documentId/redact/:runId`
- TanStack Router file route at `apps/web/src/routes/matters/$matterId/documents/$documentId/redact/$runId.tsx`
- Route loads run data via `useRedactionRun` in the component
- Sidebar: Change "Redaction" entry in `SidebarNavigation.tsx` from `{ status: 'planned' }` to `{ status: 'live', to: '/matters' }` (the redaction route requires a matter context; the link goes to matters list where users can navigate to a document's redaction)
- When viewing a redaction run, sidebar highlights the "Redaction" entry as active

### FR12: Review UI — Empty States

- **No runs yet**: shown on document detail page when no redaction runs exist. Message: "No redaction runs for this document. Create a run to detect sensitive information." CTA button: "Create Redaction Run"
- **No spans detected**: shown inside the review UI when a run completed with zero spans. Message: "No sensitive data was detected in this document. The Privacy Filter and regex supplement did not find any matching patterns. You can still finalize this run without changes."
- **All spans reviewed**: shown in the summary bar when `reviewedCount === totalSpans`. Message: "✓ All spans reviewed — ready to finalize."

### FR13: Review UI — Loading States

- **Detection in progress**: shown while run status is `detecting`. Takeover/overlay with spinner and message: "Detection in progress — the Privacy Filter is scanning the document text. This may take a moment for large documents." Polls run status via `useRedactionRun` with refetch interval.
- **Finalizing**: shown while mutation is pending. Inline spinner on the finalize button with message: "Generating output..."

### FR14: Audit Logging

Extend the `AuditRecordInput` action union in `services/api/src/database.ts` with three new actions:

| Action | Description | Entity Type | Metadata |
|---|---|---|---|
| `redaction.run_create` | Run created (Month 1) | `redaction_run` | `{ policyMode, documentVersionId, spanCount }` |
| `redaction.span_decision` | Decision on a span | `redaction_run` | `{ spanId, decision, category }` |
| `redaction.finalize` | Run finalized | `redaction_run` | `{ outputMode, artifactId, spanCount, reviewedCount, unreviewedCount }` |

Each audit log entry includes `organisationId`, `userId`, `entityType` (`redaction_run`), `entityId` (run id), `action`, `metadata` (JSON), `requestId`, and `createdAt`.

### FR15: Extended GET Run Response

Update `GET /api/redaction-runs/:runId` to include:

```json
{
  "run": {
    "id": "red_...",
    "documentId": "...",
    "documentVersionId": "...",
    "status": "ready_for_review" | "reviewing" | "finalized" | etc.,
    "policyMode": "internal_ai_minimisation" | "external_sharing",
    "spans": [ ... RedactionSpan[] ],
    "decisions": { ... Record<string, Decision> },
    "summary": { ... summary object from FR4 },
    "outputArtifactId": "art_..." | null,
    "detectorVersion": "opf-1.5" | null,
    "createdBy": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

This already exists from Month 1; Month 2 adds the `summary` field if not already present and ensures it's computed on every read if the stored value is stale.

## Non-Functional Requirements

- Span decision API response time: < 100ms (simple database write)
- Finalize API response time: < 2s for documents up to 100K characters (dominated by output generation and object storage write)
- Review UI initial load: < 1s from API response to interactive (run data fetched via TanStack Query)
- Output generation: must handle documents up to 200K characters without timeout
- Pseudonymisation token assignment: O(n) in span count with hash-based deduplication
- Review UI must remain responsive with up to 500 spans on a single document
- Object storage writes must be idempotent (overwrite existing artifact if same path)

## Security And Compliance

- No raw document text is stored in audit log metadata.
- Redacted output artifacts must not contain recoverable original text outside `[REDACTED]` markers.
- Pseudonymised output artifacts require the token map for re-identification; the token map is stored in the run's `summary_json` (database), not in the output artifact itself.
- Access control: all endpoints require authenticated user with access to the run's organisation and matter. Follow the existing `requireUser()` pattern with org-scoping.
- Object keys must follow the existing pattern and must not contain client names, matter names, or original filenames.
- Audit logs are append-only. Redaction decisions cannot be deleted.
- Finalized runs cannot be unfinalized. A new run on the same document must be created for different redaction results.

## Dependencies

- [Redact Month 1: Detection Pipeline](redact-month1.md): Provides the detection pipeline, redaction_runs table with spans, and the `packages/redaction-policy` package with `supplement.ts`, `merge.ts`, `types.ts`.
- [Redact Month 3: Polish and Demo](redact-month3.md): Will add audit report export (PDF/HTML), DOCX extraction, and the demo fixture. Month 2 builds the audit trail storage that Month 3 exports.
- Shared contracts package (`packages/contracts`): Provides `spanDecisionSchema`, `outputModeSchema`, `redactionRunStatusSchema`, and error codes.
- Object storage: Required for reading extracted text (`text_object_key`) and writing output artifacts. Needs verification of existing wiring at the start of the sprint.
- Infrastructure (4vCPU/8GB/160GB VPS, PostgreSQL, Dokploy): Must support the additional API endpoints and UI build.

## Rollout

### Build Phase 1: Backend (Weeks 5-6 of the 3-month plan)

- Implement `apply.ts` functions in `packages/redaction-policy/` (redacted and pseudonymised output generation)
- Implement `POST /api/redaction-runs/:runId/spans/:spanId/decision` endpoint
- Implement `POST /api/redaction-runs/:runId/finalize` endpoint
- Add audit log action types to `database.ts`
- Update `GET /api/redaction-runs/:runId` to include computed summary
- Add error codes to `apiErrorCodeSchema`: `redaction_run_not_reviewable`, `redaction_already_finalized`
- Write API tests for decision submission, finalize flow, edge cases (overlapping spans, empty text, finalized run re-finalize)
- Write unit tests for `apply.ts` with legal text fixtures

### Build Phase 2: Review UI (Weeks 7-8 of the 3-month plan)

- Create `packages/app-shell/src/redact/` directory
- Implement document text view with highlighted spans (category colors, source distinction)
- Implement span list panel (sortable, filterable columns)
- Implement decision action bar with five action buttons
- Implement summary bar with reviewed/unreviewed counts
- Implement finalize dialog with output mode selector and un-reviewed warning
- Create TanStack Query hooks: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- Create TanStack Router route at `/matters/:matterId/documents/:documentId/redact/:runId`
- Update sidebar navigation: Redaction entry live with link
- Add empty states, loading states
- Write component tests with vitest

### Exit Criteria

- Span decision API accepts and persists all five decision types
- Output generation produces correct redacted and pseudonymised text
- Finalize flow stores artifact and updates run status
- Review UI renders document with highlighted spans, supports span selection and decision actions
- All empty and loading states render correctly
- Sidebar Redaction entry links to the review route
- Audit logs contain `redaction.span_decision` and `redaction.finalize` entries
- Auth-guarded, org-scoped endpoints reject unauthorised access
- All tests pass

## Metrics

- **Span decision latency**: P99 < 200ms for decision submission
- **Finalize latency**: P95 < 3s for documents up to 100K characters
- **Review UI interactive time**: < 2s from navigation start (including API fetch)
- **Pseudonymisation consistency**: 100% — same entity text within same category always maps to same token
- **Output correctness**: automated tests verify redacted output contains no spans from the original text; pseudonymised output has valid `[CATEGORY_N]` tokens with no collisions

## Risks

- **Object storage not yet wired**: If the `text_object_key` read path or artifact write path is not implemented as a reusable service, the finalize API will need a local-filesystem fallback. Mitigation: verify object storage integration at sprint start; if missing, implement a simple abstraction (`StorageService` interface) with local filesystem as the first adapter.
- **Large document performance**: Documents over 100K characters with 500+ spans may cause UI lag. Mitigation: virtualize the document text view, limit visible spans to viewport area, use windowing for the span list.
- **Overlapping span edge cases**: Privacy Filter and regex supplement may produce overlapping spans. The merge logic from Month 1 should handle this, but `apply.ts` needs to handle remaining overlaps gracefully. Mitigation: extensive test fixtures with overlapping spans; highest-confidence source wins.
- **Pseudonymisation across runs**: Month 2 scopes consistency to within a single run. Cross-run consistency is a future concern. Mitigation: document this limitation clearly in the UI and API docs.
- **Finalize without reviewing all spans**: The system warns but does not block. A firm may have compliance requirements that mandate 100% review. Mitigation: the warning is prominent in the finalize dialog; future iteration may add a setting to require full review.

## Open Questions

1. **Object storage wiring**: Does the current codebase have a reusable service for reading/writing object storage, or does it use inline S3/client calls per route? Needs investigation at sprint start.
2. **Document text storage**: Is extracted text always available at `document_versions.text_object_key` by Month 2, or does text extraction need to be completed first? Month 1 assumes text input directly; DOCX extraction is Month 3.
3. **Token map disclosure**: Who should have access to the token map for re-identification? The map is stored in `summary_json` (database), which means users with database access or API access to the run can see it. Is this acceptable, or should it be encrypted/stored separately?
4. **Redacted mode with pseudonymise decisions**: For a run finalized in `redacted` mode, should spans with `pseudonymise` decision be replaced with `[REDACTED]` (current design) or with the pseudonym token? Current design says `[REDACTED]` since the user chose redacted mode.
5. **Multiple runs on the same document**: Should the UI allow creating multiple redaction runs on the same document? If so, how does a user decide which finalized artifact to use?
