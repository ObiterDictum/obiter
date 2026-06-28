# Redact Build Plan

## Context

The target is a working product within 3 months that firms can verify, then a fuller workflow at 6 months. Redact is the right first target: it's self-contained (no dependency on legal corpus or citation resolution), it's the gateway for firms (no client docs enter any AI tool without redaction), and it produces a reviewable artifact firms can inspect.

## What Exists Already

**Database foundation (ready to build on):**
- `matters` table with org-scoped CRUD (migration 0002)
- `matter_documents` with immutable `document_versions` (migration 0002)
- `artifacts` table with `redaction_report` already in the enum (migration 0002)
- `audit_logs` table with `appendAuditLog()` function in `database.ts`
- `text_object_key` column on `document_versions` (text extraction slot exists)

**API foundation:**
- Hono app with auth middleware, CORS, request IDs, audit logging (`app.ts`)
- Matters routes: full CRUD with org-scoping (`routes/matters.ts`)
- Documents routes: upload metadata, list, get, soft-delete (`routes/documents.ts`)
- Route mounting pattern: `app.route('/', createXRoutes(pool))` in `app.ts`

**Contracts:**
- `artifactTypeSchema` already includes `redaction_report` (`packages/contracts/src/index.ts`)
- `documentStatusSchema` includes `needs_review` (for redaction review state)
- `syncStateSchema` includes `local_only` (for desktop-local redaction)

**Specs (skeletal, need expansion):**
- `docs/specs/redact/api.md` has 5 endpoint signatures, no shapes
- `docs/specs/redact/schema.md` names 3 tables, no DDL
- `docs/specs/redact/implementation.md` has 5 build steps, no detail
- `docs/specs/redact/milestones.md` has M1-M3, no week-by-week

**What doesn't exist:**
- `packages/redaction-policy/` (listed in architecture.md, not created)
- `services/redact-worker/` (listed as dead code to clean, empty)
- Any redaction API routes
- Any redaction UI components
- Any text extraction pipeline
- Any detection logic

## Detection: OpenAI Privacy Filter

OpenAI Privacy Filter is the detection engine. Released April 2026, Apache 2.0 license (compatible with AGPL).

**Why Privacy Filter:**
- Context-aware detection, not regex pattern matching. Understands "Mr Smith" is a name, "Smith v Jones" is a case citation, not a person to redact
- 1.5B total params, 50M active, runs on CPU (`--device cpu`)
- 128k token context window, processes entire legal documents in one pass
- State-of-the-art on PII-Masking-300k benchmark (97.43% F1)
- Fine-tuning support built in. F1 jumped 54% to 96% with small amounts of domain data. Legal text is exactly the use case for fine-tuning
- Runs locally, no data leaves the server. This matters for client documents

**Built-in PII categories (8):**
| Label | Description |
|---|---|
| `private_person` | Names of private individuals |
| `private_address` | Physical addresses |
| `private_email` | Email addresses |
| `private_phone` | Phone numbers |
| `private_url` | URLs containing PII |
| `private_date` | Dates tied to private individuals |
| `account_number` | Credit cards, bank accounts |
| `secret` | Passwords, API keys |

**Gaps for UK legal text (need supplement):**
- National Insurance numbers (fixed format: 2 letters, 6 digits, 1 letter)
- Passport numbers
- Internal case/matter references
- Organisation names (the model flags `organisation_name` but firms may want to treat these differently)
- Court reference numbers (distinct from `private_url` or `account_number`)

**Two-layer detection strategy:**
1. OpenAI Privacy Filter runs first (context-aware, catches names, addresses, emails, phones, dates, account numbers, secrets)
2. TypeScript regex supplement runs second, catching UK legal-specific patterns the model doesn't cover (NI numbers, passport numbers, case references)

Both layers return spans. The TypeScript supplement merges with model output, deduplicates overlaps (model wins on confidence), and produces the final span list.

**`services/redact-worker/` is a real Python service:**
- Runs OpenAI Privacy Filter (`opf` package from `openai/privacy-filter` GitHub repo)
- Accepts text via internal API call from the Hono API
- Returns spans as JSON
- CPU mode for the 4vCPU/8GB server (no GPU available)
- Model weights auto-downloaded on first run (~1.5GB, cached at `~/.opf/privacy_filter`)

## Architecture

### Text Extraction
Start with plain text and `.txt` files for M1, then `.docx` in M2. The `text_object_key` column on `document_versions` already exists for storing extracted text.

**M1 approach:** Accept text input directly. Upload a document, extract text (for M1: just read the `.txt` file content), store in object storage at the `text_object_key` path. This gets the pipeline working end-to-end before DOCX.

### Detection Pipeline
1. Document text extracted and stored at `text_object_key`
2. API receives redaction run request, calls the Python redact-worker
3. Redact-worker runs Privacy Filter on the text, returns spans
4. API runs TypeScript regex supplement for UK legal-specific patterns (NI numbers, passport, case references)
5. API merges both span sets, deduplicates, stores in `redaction_runs.spans_json`
6. Run transitions to `ready_for_review`

### TypeScript vs Python Split
- **Python (redact-worker):** Privacy Filter model inference only. Takes text, returns spans. No business logic, no database access, no API exposure to the outside world
- **TypeScript (API):** Run lifecycle, span decisions, pseudonymisation, output generation, audit logging, regex supplement, span merging. All the product logic stays in TypeScript

### Storage
Redaction runs stored in PostgreSQL. Spans stored as JSONB array within the run (simpler than a separate spans table for Phase 1). Output artifacts go to the existing `artifacts` table with type `redaction_report`.

### Desktop-Local
M1 is hosted-only (API). Desktop-local redaction is M3+ scope. The `syncState: 'local_only'` enum exists, but the Electron local processing path is not in the first 3 months. Firms can use the hosted version first.

## Schema

```sql
-- migration: 0005_redaction.sql

create table if not exists redaction_runs (
  id text primary key default ('red_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  document_version_id text not null,
  status text not null default 'pending',
  policy_mode text not null default 'internal_ai_minimisation',
  spans_json jsonb not null default '[]'::jsonb,
  decisions_json jsonb not null default '{}'::jsonb,
  output_artifact_id text,
  summary_json jsonb not null default '{}'::jsonb,
  detector_version text,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redaction_runs_id_prefix_check check (id like 'red_%'),
  constraint redaction_runs_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint redaction_runs_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id),
  constraint redaction_runs_version_fk foreign key (document_version_id, document_id, matter_id, organisation_id)
    references document_versions(id, matter_document_id, matter_id, organisation_id),
  constraint redaction_runs_status_check check (
    status in ('pending', 'detecting', 'ready_for_review', 'reviewing', 'finalized', 'failed')
  ),
  constraint redaction_runs_policy_mode_check check (
    policy_mode in ('internal_ai_minimisation', 'external_sharing')
  )
);

create index if not exists redaction_runs_matter_idx
  on redaction_runs (matter_id);

create index if not exists redaction_runs_document_idx
  on redaction_runs (document_id);

create index if not exists redaction_runs_status_idx
  on redaction_runs (status);

create index if not exists redaction_runs_organisation_matter_idx
  on redaction_runs (organisation_id, matter_id);
```

**Spans format** (stored in `spans_json`):
```typescript
interface RedactionSpan {
  id: string                    // 'span_<uuid>'
  start: number                 // char offset in extracted text
  end: number                   // char offset (exclusive)
  text: string                  // the matched text
  category: SpanCategory        // what type of PII
  source: 'privacy_filter' | 'regex_supplement'  // which layer detected it
  confidence: 'high' | 'medium' | 'low'
  suggestion: 'redact' | 'pseudonymise' | 'keep'
}

type SpanCategory =
  | 'person_name'           // privacy_filter: private_person
  | 'email'                 // privacy_filter: private_email
  | 'phone'                 // privacy_filter: private_phone
  | 'address'               // privacy_filter: private_address
  | 'date'                  // privacy_filter: private_date
  | 'account_number'        // privacy_filter: account_number
  | 'secret'                // privacy_filter: secret
  | 'url'                   // privacy_filter: private_url
  | 'national_insurance'    // regex_supplement: UK NI number
  | 'passport'              // regex_supplement: UK passport number
  | 'case_reference'        // regex_supplement: internal firm/matter ref
  | 'organisation_name'     // regex_supplement or privacy_filter
```

**Decisions format** (stored in `decisions_json`):
```typescript
// keyed by span id
type Decisions = Record<string, {
  decision: 'accept' | 'reject' | 'override_redact' | 'override_keep' | 'pseudonymise'
  decidedBy: string            // user id
  decidedAt: string            // ISO timestamp
}>
```

## API Surface

All endpoints are auth-guarded, org-scoped, mounted under `/api/`.

### Create a redaction run
```
POST /api/documents/:documentId/redaction-runs
Body: { policyMode?: 'internal_ai_minimisation' | 'external_sharing' }
Response 201: {
  run: {
    id: string
    documentId: string
    status: 'pending' | 'detecting'
    policyMode: string
    createdAt: string
  }
}
```
Creates the run, triggers detection. The API calls the Python redact-worker with the extracted text. Status transitions: pending -> detecting -> ready_for_review. If the worker is unavailable, status goes to `failed` with a reason.

### Get run status + spans
```
GET /api/redaction-runs/:runId
Response 200: {
  run: {
    id: string
    documentId: string
    status: RedactionRunStatus
    policyMode: string
    spans: RedactionSpan[]
    decisions: Record<string, Decision>
    summary: {
      totalSpans: number
      byCategory: Record<SpanCategory, number>
      bySource: { privacyFilter: number, regexSupplement: number }
      reviewedCount: number
      unreviewedCount: number
    }
    createdAt: string
    updatedAt: string
  }
}
```

### Submit a span decision
```
POST /api/redaction-runs/:runId/spans/:spanId/decision
Body: { decision: 'accept' | 'reject' | 'override_redact' | 'override_keep' | 'pseudonymise' }
Response 200: {
  run: { ...same shape as GET, with updated decisions }
}
```
Updates `decisions_json`. Writes audit log entry `redaction.span_decision`.

### Finalize a run
```
POST /api/redaction-runs/:runId/finalize
Body: { outputMode: 'redacted' | 'pseudonymised' }
Response 200: {
  run: {
    id: string
    status: 'finalized'
    outputArtifactId: string
  }
  artifact: {
    id: string
    objectKey: string
    artifactType: 'redaction_report'
  }
}
```
Applies all decisions: redacted text removes spans entirely (replaces with `[REDACTED]`), pseudonymised text replaces with consistent tokens (`[PERSON_1]`, `[PERSON_2]`, etc.). Stores output as artifact. Writes audit log `redaction.finalize`.

### List runs for a document
```
GET /api/documents/:documentId/redaction-runs
Response 200: { runs: RedactionRunSummary[] }
```

## Contracts

Add to `packages/contracts/src/index.ts`:

```typescript
export const spanCategorySchema = z.enum([
  'person_name', 'email', 'phone', 'address', 'date',
  'account_number', 'secret', 'url',
  'national_insurance', 'passport', 'case_reference', 'organisation_name',
])

export const spanSourceSchema = z.enum(['privacy_filter', 'regex_supplement'])

export const redactionRunStatusSchema = z.enum([
  'pending', 'detecting', 'ready_for_review',
  'reviewing', 'finalized', 'failed',
])

export const redactionPolicyModeSchema = z.enum([
  'internal_ai_minimisation', 'external_sharing',
])

export const spanConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const spanSuggestionSchema = z.enum(['redact', 'pseudonymise', 'keep'])

export const spanDecisionSchema = z.enum([
  'accept', 'reject', 'override_redact', 'override_keep', 'pseudonymise',
])

export const outputModeSchema = z.enum(['redacted', 'pseudonymised'])

// Error codes to add to apiErrorCodeSchema:
// 'redaction_run_not_found', 'span_not_found', 'redaction_run_not_reviewable'
// 'redaction_already_finalized', 'redaction_worker_unavailable'
```

## Package Structure

### `services/redact-worker/` (Python)
Runs OpenAI Privacy Filter. Internal service, not exposed to the outside world.

```
services/redact-worker/
  pyproject.toml              - opf dependency, torch, fastapi/uvicorn
  src/
    server.py                 - FastAPI app: POST /detect, takes text, returns spans
    detector.py               - loads Privacy Filter model, runs inference
    spans.py                  - maps model output (BIOES tags) to Ormont span format
  Dockerfile                  - Python 3.11-slim, model weights cached
```

**Internal API:**
```
POST http://localhost:8788/detect
Body: { text: string }
Response 200: {
  spans: [{
    start: number
    end: number
    text: string
    category: string   // privacy_filter label
    confidence: 'high' | 'medium' | 'low'
  }]
}
```

The Hono API calls this internally. No auth needed (localhost only, not exposed). If the worker is down, the API returns `redaction_worker_unavailable` and the run goes to `failed`.

### `packages/redaction-policy/` (TypeScript)
Pure TypeScript logic for: regex supplement, span merging, pseudonymisation, output generation. No framework dependencies. Testable in isolation.

```
packages/redaction-policy/
  src/
    index.ts           - public API
    supplement.ts       - regex patterns for UK legal-specific PII (NI, passport, case refs)
    merge.ts            - merge Privacy Filter spans + regex supplement spans, deduplicate overlaps
    pseudonym.ts        - consistent token assignment
    apply.ts            - apply decisions to text, produce redacted/pseudonymised output
    types.ts            - RedactionSpan, SpanCategory, etc.
    index.test.ts       - test fixtures with real legal text
```

### `services/api/src/routes/redact.ts`
API route handlers. Follows the existing pattern in `routes/matters.ts` and `routes/documents.ts`: `createRedactRoutes(pool)` returns a Hono instance, mounted in `app.ts`.

### `services/api/src/redaction-database.ts`
Database functions for redaction runs. Follows the pattern of `database.ts`: typed query helpers, not inline SQL in routes.

### `services/api/src/redaction-worker-client.ts`
HTTP client to call the Python redact-worker. Simple fetch to `localhost:8788/detect`. Handles timeouts and failures.

### `packages/app-shell/src/redact/`
Review UI components (M2). Follows existing app-shell patterns: shared between web and desktop, TanStack Query for server state, Zustand for local UI state.

## Weekly Plan (12 Weeks / 3 Months)

### Week 1-2: Python Worker + Foundation

**Goal:** Privacy Filter running in a Python service, schema, contracts, API skeleton, regex supplement.

- [ ] Create `services/redact-worker/` with `pyproject.toml` (deps: `opf`, `torch`, `fastapi`, `uvicorn`)
- [ ] Implement `detector.py`: load Privacy Filter model, run inference on text, return spans
- [ ] Implement `spans.py`: map model BIOES output to Ormont span format (start, end, text, category, confidence)
- [ ] Implement `server.py`: FastAPI app with `POST /detect` endpoint
- [ ] Write `Dockerfile` for the worker (Python 3.11-slim, CPU-only torch, model weights cached)
- [ ] Test: run worker locally, send sample text, verify spans returned
- [ ] Write migration `0005_redaction.sql` (DDL above)
- [ ] Add redaction contracts to `packages/contracts/src/index.ts`
- [ ] Add new error codes to `apiErrorCodeSchema` (including `redaction_worker_unavailable`)
- [ ] Create `packages/redaction-policy/` with `package.json`, `tsconfig.json`
- [ ] Implement `types.ts` with all interfaces
- [ ] Implement `supplement.ts` with regex patterns for: NI numbers, passport numbers, case references
- [ ] Implement `merge.ts`: merge Privacy Filter spans + regex supplement spans, deduplicate overlaps (Privacy Filter wins on confidence)
- [ ] Write supplement + merge tests with realistic legal text fixtures
- [ ] Scaffold `services/api/src/routes/redact.ts` with `createRedactRoutes(pool)`
- [ ] Create `services/api/src/redaction-database.ts` with query helpers
- [ ] Create `services/api/src/redaction-worker-client.ts` (fetch to localhost:8788)
- [ ] Mount redact routes in `app.ts`
- [ ] Implement `POST /api/documents/:documentId/redaction-runs` (create run, call worker, merge spans, store, return run)

**Milestone M1 (partial): Python worker running, text extraction + first detection run works.**

### Week 3-4: Run Lifecycle + Decisions

**Goal:** Full run lifecycle API, span decisions, audit logging, worker failure handling.

- [ ] Implement `GET /api/redaction-runs/:runId` (return run with spans, decisions, summary)
- [ ] Implement `POST /api/redaction-runs/:runId/spans/:spanId/decision` (update decisions_json, audit log)
- [ ] Implement `GET /api/documents/:documentId/redaction-runs` (list runs)
- [ ] Add status transitions: `pending -> detecting -> ready_for_review -> reviewing -> finalized`
- [ ] Auto-transition to `reviewing` when first decision is submitted
- [ ] Handle worker failures: if worker unavailable, set status to `failed`, record `failure_reason`
- [ ] Audit log entries: `redaction.run_create`, `redaction.span_decision`, `redaction.finalize`
- [ ] Add `redaction.run_create`, `redaction.span_decision`, `redaction.finalize` to the `AuditRecordInput` action union in `database.ts`
- [ ] API tests: create run, get run, submit decisions, verify state changes
- [ ] Error handling: run not found, span not found, run already finalized, run not in reviewable state, worker unavailable

**Milestone M1 (complete): detection works, spans stored, decisions persist.**

### Week 5-6: Output + Finalize

**Goal:** Apply decisions, produce redacted/pseudonymised output, store as artifact.

- [ ] Implement `apply.ts` in `redaction-policy`:
  - `applyRedacted(text, spans, decisions)` -> text with `[REDACTED]` replacements
  - `applyPseudonymised(text, spans, decisions)` -> text with `[CATEGORY_N]` tokens, consistent across the document
- [ ] Implement `POST /api/redaction-runs/:runId/finalize`:
  - Load text from `document_versions.text_object_key`
  - Apply decisions
  - Store output in object storage
  - Create `artifacts` row with type `redaction_report`
  - Update run status to `finalized`, set `output_artifact_id`
  - Audit log `redaction.finalize`
- [ ] Pseudonymisation consistency: same entity gets same token across the whole document (token map per run)
- [ ] Output tests: verify redacted text has no PII, pseudonymised text has consistent tokens
- [ ] Integration test: full flow from create run to finalize to artifact retrieval

**Milestone M2 (partial): span decisions persist, output generation works.**

### Week 7-8: Review UI

**Goal:** Redaction review screen in the app shell.

- [ ] Create `packages/app-shell/src/redact/` directory
- [ ] Document text view with highlighted spans (color by category, distinguish Privacy Filter vs supplement by border style)
- [ ] Span list panel: sortable by category, confidence, source, review status
- [ ] Click span -> highlight in document view, show decision buttons
- [ ] Decision actions: accept, reject, override to redact, override to keep, pseudonymise
- [ ] Summary bar: X spans, Y reviewed, Z unreviewed, breakdown by source (model vs supplement)
- [ ] Policy mode selector (internal AI minimisation vs external sharing) on run creation
- [ ] Finalize button with output mode selector (redacted vs pseudonymised)
- [ ] TanStack Query: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- [ ] Route: `/matters/:matterId/documents/:documentId/redact/:runId` (or `/redaction-runs/:runId`)
- [ ] Sidebar: change "Redaction" entry from `status: 'planned'` to active link
- [ ] Empty states: no runs yet, no spans detected, all spans reviewed
- [ ] Loading states: detection in progress (worker running), finalizing

**Milestone M2 (complete): review UI works, span decisions persist.**

### Week 9-10: Text Extraction + DOCX

**Goal:** Real text extraction for `.docx` files, not just `.txt`.

- [ ] Add `mammoth` (DOCX to text) as a dependency in the API service
- [ ] Text extraction endpoint or integrate into document upload flow:
  - On upload, if `fileType` is `.docx`, extract text using mammoth
  - Store extracted text at `text_object_key` path in object storage
  - Update `document_versions.document_status` to `ready`
- [ ] On redaction run creation: check if text extraction is done, if not trigger it
- [ ] Handle extraction failures: set status to `failed`, record `failure_reason`
- [ ] Test DOCX extraction with real legal document fixtures (skeleton arguments, witness statements, case reports)
- [ ] Document the text extraction flow: upload -> extract -> store text_object_key -> ready for redaction

### Week 11-12: Audit Report + Polish + Demo

**Goal:** Audit log export, the demo, internal testing.

- [ ] Implement audit log export for redaction runs:
  - `GET /api/redaction-runs/:runId/audit` -> structured audit record of all decisions, timestamps, users
  - Format as JSON for M3, HTML/Markdown export as artifact
- [ ] Redaction report artifact: contains
  - original document reference
  - redaction run summary (spans by category, by source, decisions)
  - detector version (Privacy Filter checkpoint version)
  - redacted/pseudonymised text output
  - audit log
  - reviewer, timestamp, policy mode
- [ ] Demo fixture: a realistic skeleton argument or case excerpt containing:
  - person names
  - addresses
  - dates of birth
  - national insurance numbers
  - case references
  - email addresses
  - phone numbers
- [ ] End-to-end manual test with the demo fixture: upload -> extract -> detect -> review -> finalize -> download output + audit report
- [ ] Edge cases to test and handle:
  - Overlapping spans (Privacy Filter wins over regex supplement on confidence)
  - Empty text
  - Text with no detectable PII (0 spans, valid run)
  - All spans rejected (finalized with no changes)
  - Finalize without reviewing all spans (allowed but warn)
  - Re-run redaction on same document (new run, new spans)
  - Worker timeout or unavailable (run goes to `failed`)
- [ ] Type-check everything: `pnpm --filter @ormont/redaction-policy typecheck`, `pnpm --filter @ormont/api typecheck`, `pnpm --filter @ormont/app-shell typecheck`
- [ ] Run all tests: `pnpm --filter @ormont/redaction-policy test`, `pnpm --filter @ormont/api test`
- [ ] Update `docs/current-product-scope.md`: move Redaction from "Visible But Not Implemented" to implemented navigation
- [ ] Update `docs/specs/redact/milestones.md` with completion notes

**Milestone M3 (complete): pseudonymised and redacted export works, audit log export works.**

## What's NOT In Scope (First 3 Months)

- PDF-safe redaction (needs Python worker with PDF manipulation beyond text replacement)
- Privacy Filter fine-tuning on legal text (the pipeline is built, fine-tuning is Phase 2 when we have evaluation fixtures)
- Desktop-local redaction (Electron offline path)
- Batch redaction (multiple documents at once)
- Redaction policy customization (firm-specific rules)
- BullMQ job queue (synchronous detection call to worker is fine for single documents; queue comes for batch processing)
- Legislation/case law redaction (public source redaction is different from matter document redaction)

## Dependencies On Existing Code

| Dependency | Status |
|------------|--------|
| `matters` table + CRUD | Done (migration 0002, `matters.ts`) |
| `matter_documents` + `document_versions` | Done (migration 0002, `documents.ts`) |
| `artifacts` table with `redaction_report` type | Done (migration 0002) |
| `audit_logs` + `appendAuditLog()` | Done (`database.ts`) |
| `text_object_key` on document versions | Done (migration 0002) |
| Auth middleware, org-scoping, request IDs | Done (`app.ts`) |
| Object storage for text/output | Needs verification: is Hetzner Object Storage wired? The `object_key` pattern is defined in migration constraints but actual storage upload code needs checking |

**Risk:** Object storage upload (writing to `text_object_key` path) may not be implemented yet. Document upload currently creates the DB record but may not store the actual file. Verify before Week 5. If not wired, use local filesystem as interim.

**Risk:** Python worker on the 4vCPU/8GB server. Privacy Filter runs on CPU but the model is 1.5B params. First inference loads the model into memory (~3GB). Need to verify the worker stays resident or implement a warm-up step. If memory is tight, the worker may need to be a long-running process, not spawned per request.

## Verification

Per TESTING.md, redaction is a high-risk area. Required testing:

- **Detection tests:** fixture-based, covering each span category with real legal text, edge cases (UK NI number format, name prefixes, international phone numbers)
- **Worker integration tests:** verify Privacy Filter returns correct spans for known PII patterns, verify API handles worker timeout/unavailable gracefully
- **Span merge tests:** verify Privacy Filter + regex supplement spans merge correctly, overlaps resolved by confidence
- **Decision persistence tests:** create run, submit decisions, reload run, verify decisions intact
- **Output safety tests:** assert no PII strings appear in redacted output, assert pseudonymised tokens are consistent
- **Audit log tests:** verify every action (run create, span decision, finalize) produces an audit record
- **API error tests:** run not found, span not found, already finalized, not reviewable, wrong org, worker unavailable
- **Status transition tests:** verify legal transitions only (can't finalize a pending run, can't add decisions to a finalized run)

## Months 4-6 (Follow-Up: Verify Core)

After Redact M1-M3 is deliverable at 3 months, the next 3 months target Verify Core:

1. Authority existence checks (is this citation real?)
2. Citation resolution (does it resolve to a source in the corpus?)
3. Quote fidelity (does the quoted text match the source?)
4. Findings UI (reviewable verification results)
5. Verification report export

This layers on top of the existing Search infrastructure and the artifact/audit patterns built during Redact. The same `artifacts` table, audit logging, and review UI patterns apply directly.

## Demo (For Firms)

At 3 months, the demo is:
1. Open a matter
2. Upload a `.docx` legal document (skeleton argument, witness statement, or case excerpt)
3. System detects PII using OpenAI Privacy Filter (context-aware, not regex): names, addresses, emails, phone numbers, dates, account numbers, secrets. Plus UK legal-specific patterns from the supplement: NI numbers, passport numbers, case references
4. Review each detection: accept, reject, override, or pseudonymise. Spans are tagged by source so the reviewer can see which came from the model vs the supplement
5. Finalize: produce a redacted version and a pseudonymised version
6. Download the redacted document and an audit report showing every decision, who made it, when, the policy mode, and the detector version used

This is something a firm can:
- Inspect the audit trail
- Verify no PII leaks in the redacted output
- Pseudonymise for internal AI use
- Trust the process is conservative (human review required, no auto-signoff)
- Verify the detection engine is a real model (OpenAI Privacy Filter), not pattern matching