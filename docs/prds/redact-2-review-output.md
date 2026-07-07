# Redact PRD 2: Review, Decisions, and Output

## Summary

This phase builds the human review layer on top of Phase 1's detection pipeline. After detection runs and spans are stored, reviewers need to examine every detected span, make a decision (accept, reject, override, or pseudonymise), and produce a final output artifact. This phase delivers the span decisions API, the output generation engine (redacted and pseudonymised modes), the finalize flow, a complete review UI, artifact storage integration, and audit logging for all redaction actions.

After Phase 2 is complete, a user can:
1. Create a redaction run and see its detected spans (built in [Phase 1](redact-1-detection.md))
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

Without Phase 2, the product has detection but no delivery — spans exist but cannot be acted on, and no useful output is produced.

## Product Principles

- **Human-in-the-loop**: no automated redaction is applied without human review of every span.
- **Every decision is auditable**: accept, reject, override, and pseudonymise decisions are recorded with reviewer identity and timestamp.
- **Output is irreversible**: redacted output replaces spans with `[REDACTED]` — original text is not recoverable from the output artifact. Pseudonymised output preserves readability but requires the token map for re-identification.
- **Consistency matters**: pseudonymisation must use the same token for the same entity across the entire document.
- **Detection source transparency**: the UI must distinguish Rampart model spans, Rampart deterministic spans, and UK supplement spans so reviewers can calibrate trust by source.
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

- No automated/ML-assisted decision suggestions (Phase 3 or later).
- No batch decision-making for categories or sources (future).
- No DOCX extraction or non-text document handling (Phase 3).
- No desktop-local redaction (Phase 3+).
- No redaction report export as PDF/HTML audit artifact (Phase 3).
- No re-detection or edit detection parameters after run creation (future).

## Users

### Reviewing Lawyer

The primary user. Opens a redaction run, reviews detected spans in context of the original document text, and makes a decision on each span. Needs clear visual distinction between detection sources, confidence indicators, and the ability to see the full document text with highlighted spans.

### Matter Supervisor

Oversees redaction quality. Can view audit logs of decisions, verify that all spans were reviewed, and download final output artifacts. May re-run redaction if the initial detection was insufficient.

### Compliance Officer

Needs the audit trail for regulatory review. Inspects decision records, timestamps, reviewer identity, and output artifacts to confirm proper handling of sensitive data.

## Core Use Cases

1. **Review detected spans**: Open a redaction run ready for review. See all detected spans highlighted in the document text. Distinguish between Rampart model (AI), Rampart deterministic (regex + checksum), and UK supplement (legal-specific patterns) detections.

2. **Make a decision on a span**: Click a span in the document or select it from the list. Choose accept (use the suggested redaction), reject (keep the original text), override to redact (force redact even if model suggested keep), override to keep (force keep even if model suggested redact), or pseudonymise (replace with a category token).

3. **Sort and filter spans**: Sort the span list by category, confidence, detection source, or review status. Filter to show only unreviewed spans, or only spans from a specific category or source.

4. **Finalize a run**: After reviewing the desired spans, select output mode (redacted or pseudonymised) and finalize. The system applies all decisions, generates the output text, stores it as an artifact, and marks the run as finalized.

5. **View and download output**: Access the finalized artifact from the run detail view. Download or inspect the redacted or pseudonymised document.

6. **Inspect audit trail**: View decision history for a run, including who decided what and when.

## Scope

Phase 2 covers four areas:

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
- Creates `artifacts` row with type `redaction_output`
- Updates run status to `finalized`, sets `output_artifact_id`
- Writes audit log entry `redaction.finalize`
- Validation: cannot finalize a run in `pending` or `detecting` state (error: `redaction_run_not_reviewable`)
- Validation: cannot finalize an already-finalized run (error: `redaction_already_finalized`)
- Integrity check before output generation: every output-affecting span's text must match the document text at its recorded offsets; any mismatch aborts finalize with `redaction_span_integrity_error` (fail-closed — no partial output)
- `GET /api/redaction-runs/:runId/token-map` — audited re-identification endpoint for pseudonymised runs (token map is excluded from all standard responses)
- Warning (not block) if any spans remain un-reviewed — returned in response body as `unreviewedSpanIds: string[]`
- Object storage is not wired (verified July 2026: no storage client exists in the API; document upload stores metadata only). Finalize uses the `StorageService` abstraction introduced in Phase 1, whose first adapter is local filesystem storage (documented as tech debt; the object-storage adapter arrives in Phase 3)

### 4. Review UI (`packages/redact-ui`)

The review UI lives in its own package, `@ormont/redact-ui`, owned entirely by the Redact track (decided July 2026 — package-level separation keeps the parallel shell-rebuild and Redact tracks from editing the same package). It imports `@ormont/ui` components, design tokens, and `@ormont/app-shell` public helpers per the component contract; the web app's route files import the review screens from `@ormont/redact-ui`.

- Document text view with highlighted spans (color by category)
- Visual distinction between Rampart model spans, Rampart deterministic spans, and UK supplement spans (border style or icon)
- Span list panel: sortable by category, confidence, source, review status
- Click span -> highlight in document view, show decision buttons
- Decision action buttons: accept, reject, override redact, override keep, pseudonymise
- Summary bar: X spans total, Y reviewed, Z unreviewed, breakdown by source (Rampart model vs deterministic vs UK supplement)
- Policy mode selector on run creation (already in Phase 1 API; UI shows current mode and its meaning)
- Finalize button with output mode selector (redacted vs pseudonymised)
- TanStack Query hooks: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- Route: `/matters/:matterId/documents/:documentId/redact/:runId`
- Document detail entry point: provided by the app shell rebuild ([App Shell Rebuild PRD](app-shell-rebuild.md), FR4) — a document detail route at `/matters/:matterId/documents/:documentId` with a redaction runs region and "Create Redaction Run" CTA. This phase's review route nests beneath it and populates the runs region
- Sidebar: change "Redaction" entry from `status: 'planned'` to active link with `to` attribute (the sidebar is shell-owned — coordinate this one-line change with the shell track at integration rather than editing `@ormont/app-shell` directly)
- Empty states: no runs yet for this document, no spans detected (run completed with zero spans), all spans reviewed
- Loading states: detection in progress (Rampart scanning text), finalizing
- No `useEffect` for data fetching (repo convention — use TanStack Query)

## Data Model Decisions

### Decoupled Output Storage

The redacted/pseudonymised output is stored as an `artifacts` row with type `redaction_output`. This is a new artifact type: the migration 0002 artifact type enum must be extended to include it. The existing `redaction_report` type is reserved for the Phase 3 audit report artifact, which is a separate artifact from the output. The `object_key` follows the existing pattern:

```
org/{org_id}/matters/{matter_id}/artifacts/{artifact_id}
```

The artifact references `document_version_id` to trace back to the source document version. The run's `output_artifact_id` provides the link from the run to its output.

### Object Storage Integration

The database schema defines the storage paths — `object_key` on document versions and artifacts, `text_object_key` on document versions — with constraints enforcing the path shape, but no storage wiring exists in the codebase (verified July 2026): document upload records metadata only, no file bytes reach the server, and there is no storage client anywhere in the API.

For this phase, the finalize API needs to:
1. Read extracted text at `document_versions.text_object_key` (written by Phase 1's fallback-text persistence — see [Redact PRD 1](redact-1-detection.md), Open Question 7)
2. Write the output text at the artifact's `object_key` path

Both go through the `StorageService` abstraction introduced in Phase 1, with local filesystem as the first adapter. This is documented as tech debt to be resolved in Phase 3, which adds binary upload and the object-storage adapter.

### Concurrency And Atomicity

- **Span decisions**: each decision write MUST be atomic at the database level — a single `UPDATE` using `jsonb_set` on the span's key (or an equivalent transaction with a row lock), never an application-level read-modify-write of the whole `decisions_json` blob. Two reviewers deciding *different* spans concurrently must both persist.
- **Same-span races**: MVP assumes a single active reviewer per run; concurrent decisions on the *same* span resolve as last-write-wins. Every decision is individually audited (`redaction.span_decision`), so the sequence is reconstructible after the fact.
- **Finalize**: runs inside one transaction with `SELECT ... FOR UPDATE` on the run row and a status re-check after acquiring the lock (see Finalize flow). Double-finalize is therefore impossible: the second request observes `finalized` and receives `redaction_already_finalized`.
- **Summary recomputation**: the summary is recomputed from `spans_json` + `decisions_json` inside the same transaction as the mutation that changed them, so it can never be observed out of sync with the decisions it summarises.

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

This enables verification of pseudonymised output and re-identification if needed. The token map follows the pattern `{CATEGORY}_{N}` with uppercase category names.

**Token map access control:** the token map is the re-identification key for pseudonymised output — the two must not travel together. The `tokenMap` key is stored in `summary_json` but MUST be stripped from the `summary` object in every standard API response (`GET /api/redaction-runs/:runId`, list endpoints, decision/finalize responses). Re-identification access goes through a dedicated endpoint:

```
GET /api/redaction-runs/:runId/token-map
Response 200: { "tokenMap": { "PERSON_1": "James Cartwright", ... } }
Response 400: run not finalized or finalized in redacted mode (no token map)
Response 404: run not found / not in org scope
```

Every call writes an audit log entry `redaction.token_map_access` (entity: the run, metadata: `{ tokenCount }`), so re-identification events are individually traceable. For MVP, access requires the same org-scoped authentication as the run itself; restricting it to an elevated role is post-MVP (when roles exist).

**Known limitation — text-keyed consistency:** pseudonym consistency is keyed on the entity *text* within a category, not on entity identity. "Smith" the claimant and "Smith" appearing in a case citation resolve to the same token if both are `person_name` spans. This is acceptable for MVP but MUST be documented in the UI/API docs so evaluators are not surprised; entity-identity resolution is a future concern.

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

- Handle overlapping spans: if a higher-confidence span (Rampart) overlaps a lower-confidence span (UK supplement), and both have decisions that affect output, the higher-confidence span's replacement takes priority.

- Edge cases:
  - Empty text: return empty string
  - No decisions: return original text
  - All spans rejected: return original text
  - Span text not found at offset (i.e. `text.slice(span.start, span.end) !== span.text`): **fail closed**. Throw a typed integrity error that finalize maps to `redaction_span_integrity_error`. Never skip: a reviewer accepted that span for redaction, and silently skipping it would ship PII in the output. An offset mismatch means the text and spans are out of sync — a state that should be impossible when runs are pinned to a document version, so it must surface as a hard failure, not a warning.

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
    "artifactType": "redaction_output"
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
- 409: span text does not match document text at recorded offsets
       (redaction_span_integrity_error) — response advises creating a
       new run; no output artifact is produced
```

Finalize flow (all steps inside a single database transaction; step 1 acquires `SELECT ... FOR UPDATE` on the run row so concurrent finalize attempts serialize — the second sees `finalized` and gets `redaction_already_finalized`):
1. Lock the run row and validate it is in `reviewing` or `ready_for_review` status
2. Load document version's extracted text from `text_object_key` via the storage service
3. **Integrity check (fail-closed)**: for every span with an output-affecting decision, assert `text.slice(span.start, span.end) === span.text`. On any mismatch, abort the entire finalize with `redaction_span_integrity_error`. No partial output is ever written.
4. Compute pseudonymisation token map if needed (for both modes, actually, since pseudonymised mode needs it and redacted mode may want the map stored for reference)
5. Apply decisions using the appropriate apply function
6. Write output text to object storage at artifact path
7. Insert `artifacts` row with type `redaction_output`, status `ready`, object_key, document_version_id
8. Update run: status = `finalized`, `output_artifact_id` = artifact id, store token map in `summary_json`
9. Write audit log: `redaction.finalize` with metadata: `{ outputMode, artifactId, spanCount: X, reviewedCount: Y, unreviewedCount: Z }`
10. Return run with artifact details and any warnings

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
    "government_id": 0,
    "account_number": 1,
    "secret": 0,
    "url": 1,
    "ip_address": 0,
    "national_insurance": 3,
    "passport": 1,
    "drivers_license": 0,
    "case_reference": 2,
    "organisation_name": 1
  },
  "bySource": {
    "rampartModel": 30,
    "rampartDeterministic": 5,
    "ukSupplement": 7
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
- Category color mapping (driven by the shell's design tokens — one `--ormont-span-*` token per category per the [App Shell Rebuild PRD](app-shell-rebuild.md) component contract; the hues below are indicative, not hardcoded values):
  - `person_name`: red/rose
  - `email`: amber
  - `phone`: orange
  - `address`: yellow
  - `date`: violet
  - `government_id`: green
  - `account_number`: pink
  - `secret`: red
  - `url`: cyan
  - `ip_address`: fuchsia
  - `drivers_license`: lime
  - `national_insurance`: teal
  - `passport`: indigo
  - `case_reference`: blue
  - `organisation_name`: purple
- Rampart model spans: solid underline or continuous highlight
- Rampart deterministic spans: dotted underline
- UK supplement spans: dashed border or hashed highlight pattern
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
  - Source breakdown: X from Rampart model, Y from Rampart deterministic, Z from UK supplement
  - If all spans reviewed: "✓ All spans reviewed" badge with green styling
  - If no spans: "No sensitive data detected in this document"
- Summary bar is read from the run's `summary_json` field

### FR9: Review UI — Finalize Button

- "Finalize" button in the top-right of the review screen
- Enabled whenever the run is in `ready_for_review` or `reviewing` state (a zero-span run has no decisions to make and must still be finalizable)
- On click: show a dialog/modal with:
  - Output mode selector: radio buttons for "Redacted" or "Pseudonymised"
  - Description of each mode:
    - Redacted: replaces all sensitive text with `[REDACTED]` — irreversible
    - Pseudonymised: replaces with consistent tokens like `[PERSON_1]` — readable; re-identifiable only by authorised users with access to the stored token map
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
- Prerequisite route: `/matters/:matterId/documents/:documentId` (document detail) is delivered by the app shell rebuild ([App Shell Rebuild PRD](app-shell-rebuild.md), FR4; part of its Milestone 1 contract); it hosts the run list, the "Create Redaction Run" CTA, and the FR12 "no runs yet" empty state. This phase builds the `redact/$runId` sub-route beneath it
- Route loads run data via `useRedactionRun` in the component
- Sidebar: Change "Redaction" entry in `SidebarNavigation.tsx` from `{ status: 'planned' }` to `{ status: 'live', to: '/matters' }` (the redaction route requires a matter context; the link goes to matters list where users can navigate to a document's redaction)
- When viewing a redaction run, sidebar highlights the "Redaction" entry as active

### FR12: Review UI — Empty States

- **No runs yet**: shown on document detail page when no redaction runs exist. Message: "No redaction runs for this document. Create a run to detect sensitive information." CTA button: "Create Redaction Run"
- **No spans detected**: shown inside the review UI when a run completed with zero spans. Message: "No sensitive data was detected in this document. Rampart and the UK supplement did not find any matching patterns. You can still finalize this run without changes."
- **All spans reviewed**: shown in the summary bar when `reviewedCount === totalSpans`. Message: "✓ All spans reviewed — ready to finalize."

### FR13: Review UI — Loading States

- **Detection in progress**: shown while run status is `detecting`. Takeover/overlay with spinner and message: "Detection in progress — Rampart is scanning the document text. This may take a moment for large documents." Polls run status via `useRedactionRun` with refetch interval.
- **Finalizing**: shown while mutation is pending. Inline spinner on the finalize button with message: "Generating output..."

### FR14: Audit Logging

Extend the `AuditRecordInput` action union in `services/api/src/database.ts` with three new actions:

| Action | Description | Entity Type | Metadata |
|---|---|---|---|
| `redaction.run_create` | Run created (Phase 1) | `redaction_run` | `{ policyMode, documentVersionId, spanCount }` |
| `redaction.span_decision` | Decision on a span | `redaction_run` | `{ spanId, decision, category }` |
| `redaction.finalize` | Run finalized | `redaction_run` | `{ outputMode, artifactId, spanCount, reviewedCount, unreviewedCount }` |
| `redaction.token_map_access` | Token map read (re-identification event) | `redaction_run` | `{ tokenCount }` |

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
    "detectorVersion": "rampart-0.1.3" | null,
    "createdBy": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

This already exists from Phase 1; Phase 2 adds the `summary` field if not already present and ensures it's computed on every read if the stored value is stale. The serialised `summary` MUST exclude the `tokenMap` key — the token map is only accessible via the dedicated, audited `GET /api/redaction-runs/:runId/token-map` endpoint (see Pseudonymisation Token Map).

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
- Pseudonymised output artifacts require the token map for re-identification; the token map is stored in the run's `summary_json` (database), not in the output artifact itself. It is stripped from all standard API responses and only served via the dedicated `token-map` endpoint, where every read is audit-logged as a re-identification event.
- **Data retention and erasure**: `spans_json`, token maps, output artifacts, and extracted text contain client PII and follow the matter lifecycle — deleting a matter or document version MUST delete its redaction runs and output artifacts. Audit logs are retained append-only but contain no raw document text (span ids and categories only), so erasure requests can be honoured without breaking the audit trail. Configurable retention periods per organisation are post-MVP; the lifecycle coupling is the MVP requirement.
- Access control: all endpoints require authenticated user with access to the run's organisation and matter. Follow the existing `requireUser()` pattern with org-scoping.
- Object keys must follow the existing pattern and must not contain client names, matter names, or original filenames.
- Audit logs are append-only. Redaction decisions cannot be deleted.
- Finalized runs cannot be unfinalized. A new run on the same document must be created for different redaction results.

## Dependencies

- [Redact PRD 1: Detection Pipeline](redact-1-detection.md): Provides the detection pipeline, redaction_runs table with spans, and the `packages/redaction-policy` package with `supplement.ts`, `merge.ts`, `types.ts`.
- [Redact PRD 3: Production Readiness](redact-3-production.md): Will add audit report export (PDF/HTML), DOCX extraction, and the demo fixture. This phase builds the audit trail storage that Phase 3 exports.
- Shared contracts package (`packages/contracts`): Provides `spanDecisionSchema`, `outputModeSchema`, `redactionRunStatusSchema`, and error codes.
- Storage: verified not wired (July 2026). Reads and writes go through the `StorageService` abstraction (local-filesystem adapter) introduced in Phase 1 for fallback-text persistence. The object-storage adapter is Phase 3 scope.
- App shell rebuild ([App Shell Rebuild PRD](app-shell-rebuild.md)): the current shell renders Phase 0 demo fixture data and nothing in the web app calls `/api/matters` (verified July 2026). The rebuild runs as a parallel track and delivers real auth/matters wiring, the `@ormont/ui` component library, design tokens, the `apiFetch`/`useCurrentUser` helpers, and the document detail route. This phase's review UI is built against the rebuild's component contract, which freezes at its Milestone 1 — the review UI build (Build Phase 2 below) MUST NOT start before that freeze, and imports only contract exports, never shell internals.
- Infrastructure (4vCPU/8GB/160GB VPS, PostgreSQL, Dokploy): Must support the additional API endpoints and UI build.

## Rollout

### Build Phase 1: Backend (Weeks 5-6 of the 3-month plan)

- Implement `apply.ts` functions in `packages/redaction-policy/` (redacted and pseudonymised output generation)
- Implement `POST /api/redaction-runs/:runId/spans/:spanId/decision` endpoint
- Implement `POST /api/redaction-runs/:runId/finalize` endpoint (transactional, row-locked, fail-closed integrity check)
- Implement `GET /api/redaction-runs/:runId/token-map` endpoint with audit logging
- Add audit log action types to `database.ts`
- Update `GET /api/redaction-runs/:runId` to include computed summary
- Verify error codes exist in `apiErrorCodeSchema` (defined in PRD 1 contracts): `redaction_run_not_reviewable`, `redaction_already_finalized`, `redaction_span_integrity_error`
- Write API tests for decision submission, finalize flow, edge cases (overlapping spans, empty text, finalized run re-finalize, span integrity mismatch aborts with no artifact created, concurrent decisions on different spans both persist, concurrent finalize returns `redaction_already_finalized` for the loser, token map absent from standard responses and present via token-map endpoint with audit entry)
- Write unit tests for `apply.ts` with legal text fixtures

### Build Phase 2: Review UI (Weeks 7-8 of the 3-month plan)

- Create the `packages/redact-ui` package (`@ormont/redact-ui`), owned entirely by the Redact track. It imports `@ormont/ui` components, design tokens, and `@ormont/app-shell` public helpers — never shell internals
- Implement document text view with highlighted spans (category colors, source distinction)
- Implement span list panel (sortable, filterable columns)
- Implement decision action bar with five action buttons
- Implement summary bar with reviewed/unreviewed counts
- Implement finalize dialog with output mode selector and un-reviewed warning
- Create TanStack Query hooks: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- Create TanStack Router route at `/matters/:matterId/documents/:documentId/redact/:runId`
- Populate the document detail route's redaction runs region (run list + create-run CTA) — the route itself is delivered by the app shell rebuild
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

- **Object storage not wired** (verified July 2026 — no longer a question): the finalize API runs on the `StorageService` local-filesystem adapter introduced in Phase 1. Residual risk is path handling and disk permissions on the server; the object-storage adapter lands in Phase 3.
- **Parallel-track drift with the app shell rebuild**: the review UI is built by a separate track against the shell rebuild's component contract. If the review UI needs a primitive or token the contract lacks, or the contract shifts after freeze, work stalls or forks. Mitigation: the rebuild's Milestone 1 contract freeze gates the start of Build Phase 2 here; contract changes require updating both PRDs together; the plan owner reviews both tracks at each milestone. Backend (Build Phase 1) has no shell dependency and proceeds immediately.
- **Large document performance**: Documents over 100K characters with 500+ spans may cause UI lag. Mitigation: virtualize the document text view, limit visible spans to viewport area, use windowing for the span list.
- **Overlapping span edge cases**: Rampart and the UK supplement may produce overlapping spans. The merge logic from Phase 1 should handle this, but `apply.ts` needs to handle remaining overlaps gracefully. Mitigation: extensive test fixtures with overlapping spans; highest-confidence source wins.
- **Pseudonymisation across runs**: Phase 2 scopes consistency to within a single run. Cross-run consistency is a future concern. Mitigation: document this limitation clearly in the UI and API docs.
- **Pseudonym collisions on identical text**: consistency is keyed on entity text within a category, so two different people who share a surname string resolve to the same token. Mitigation: documented limitation (see Pseudonymisation Token Map); entity-identity resolution deferred.
- **Finalize without reviewing all spans**: The system warns but does not block. A firm may have compliance requirements that mandate 100% review. Mitigation: the warning is prominent in the finalize dialog; future iteration may add a setting to require full review.

## Open Questions

1. **Object storage wiring** — *Resolved (verified July 2026)*: neither. No storage client exists in the API at all; document upload is metadata-only and no file bytes reach the server. Phases 1–2 use the `StorageService` local-filesystem adapter; Phase 3 adds binary upload and the object-storage adapter.
2. **Document text storage** — *Resolved*: text extraction does not exist before Phase 3. Text is available at `text_object_key` only because Phase 1's `text` fallback persists the submitted text there ([Redact PRD 1](redact-1-detection.md), Open Question 7). Finalize reads that persisted text.
3. **Token map disclosure** — *Resolved*: the token map is stripped from all standard API responses and served only via the dedicated `GET /api/redaction-runs/:runId/token-map` endpoint, with every read audit-logged as `redaction.token_map_access`. Remaining (post-MVP): should access require an elevated role once role-based access control exists?
4. **Redacted mode with pseudonymise decisions**: For a run finalized in `redacted` mode, should spans with `pseudonymise` decision be replaced with `[REDACTED]` (current design) or with the pseudonym token? Current design says `[REDACTED]` since the user chose redacted mode.
5. **Multiple runs on the same document**: Should the UI allow creating multiple redaction runs on the same document? If so, how does a user decide which finalized artifact to use?
