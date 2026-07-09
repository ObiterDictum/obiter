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
- `packages/redaction-policy/` (listed in architecture.md, stub README only)
- Any redaction API routes
- Any redaction UI components
- Any text extraction pipeline
- Any detection logic

## Detection: Rampart

Rampart is the detection engine. National Design Studio, released June 2026, CC BY 4.0 license (compatible with AGPL).

**Why Rampart:**
- Context-aware detection, not regex pattern matching. Understands "Mr Smith" is a name, "Smith v Jones" is a case citation, not a person to redact
- 14.7 MB ONNX model, ~18.5M params, MiniLM-L6-H384 base with 35-label BIO head (17 entity types)
- Runs via Transformers.js (@huggingface/transformers) in Node.js. TypeScript-native, no Python dependency
- 98.42% private-term recall on OpenPII 30k held-out test set (7 Latin-script languages)
- 6.6 ms p50 latency on CPU (Node ONNX). 100x faster than a 1.5B param model
- Ships with a built-in deterministic recognizer layer (regex + checksum for SSN, credit card, email, URL, IP)
- Runs in-process. No separate worker service, no Docker container, no model download step
- Client-side capable. Can run in the browser or Electron desktop app, matching the "desktop-local redaction preferred" policy

**Built-in PII categories (17 entity types + 5 deterministic):**

Model labels:
| Label | Description |
|---|---|
| `GIVEN_NAME` | Given / first names |
| `SURNAME` | Family / last names |
| `PHONE` | Phone numbers |
| `TAX_ID` | Tax identifiers |
| `BANK_ACCOUNT` | Bank account / IBAN numbers |
| `ROUTING_NUMBER` | Bank routing numbers |
| `GOVERNMENT_ID` | Government-issued ID / case numbers |
| `PASSPORT` | Passport numbers |
| `DRIVERS_LICENSE` | Driver's license numbers |
| `BUILDING_NUMBER` | Street-line building number |
| `STREET_NAME` | Street name |
| `SECONDARY_ADDRESS` | Secondary-address line (apt/unit/suite) |

Deterministic recognizer labels (regex + checksum, run before model):
| Label | Description |
|---|---|
| `SSN` | Social Security Numbers (structural validation) |
| `CREDIT_CARD` | Payment card numbers (Luhn-validated) |
| `EMAIL` | Email addresses |
| `URL` | URLs |
| `IP_ADDRESS` | IPv4 / IPv6 / MAC addresses |

Kept by default (not redacted):
| Label | Description |
|---|---|
| `CITY` | City |
| `STATE` | State / region |
| `ZIP_CODE` | Postal code |

**Gaps for UK legal text (need Obiter supplement):**
- National Insurance numbers (fixed format: 2 letters, 6 digits, 1 letter)
- Internal case/matter references (firm-specific formats)
- Organisation names (optional, suffix-based: LLP, Ltd, plc, Solicitors)
- Court reference numbers (distinct from `GOVERNMENT_ID` or `URL`)

**Three-layer detection strategy:**
1. Rampart deterministic recognizer runs first (regex + checksum for SSN, credit card, email, URL, IP). Masks structured identifiers to sentinel tokens before the model runs.
2. Rampart token-classification model runs second (context-aware, catches names, phones, accounts, government IDs, passports, addresses, driver's licenses).
3. Obiter UK supplement runs third (TypeScript regex for UK-specific patterns: NI numbers, case references, organisation names).

All three layers return spans. The Obiter supplement merges with Rampart output, deduplicates overlaps (Rampart wins on confidence), and produces the final span list.

**`@nationaldesignstudio/rampart` is an npm package:**
- Runs in-process in the Hono API via Transformers.js. No separate service.
- Model weights (14.7 MB) load from HuggingFace on first use, cached on disk automatically.
- `createGuard({ device: 'cpu' })` returns a `ChatGuard` instance. `guard.protect(text)` returns `{ text, spans }`.
- No Docker container, no Python, no PyTorch, no FastAPI.

## Architecture

### Text Extraction
Start with plain text and `.txt` files for M1, then `.docx` in M2. The `text_object_key` column on `document_versions` already exists for storing extracted text.

**M1 approach:** Accept text input directly. Upload a document, extract text (for M1: just read the `.txt` file content), store in object storage at the `text_object_key` path. This gets the pipeline working end-to-end before DOCX.

### Detection Pipeline
1. Document text extracted and stored at `text_object_key`
2. API receives redaction run request, loads the Rampart guard (cached after first load)
3. API calls `guard.protect(text)` which runs the deterministic recognizer + token-classification model
4. API maps Rampart span output to Obiter span categories
5. API runs UK supplement (TypeScript regex) for patterns Rampart doesn't cover (NI numbers, case references, organisation names)
6. API merges Rampart spans + UK supplement spans, deduplicates overlaps (Rampart wins), stores in `redaction_runs.spans_json`
7. Run transitions to `ready_for_review`

### Chunking for Long Documents
Rampart has a 512-token max sequence length. Documents longer than 512 tokens must be chunked. The API service handles this:
- Split text into chunks of approximately 400 tokens (leaving room for special tokens)
- Run detection on each chunk
- Adjust span offsets back to document-level coordinates
- Merge spans across chunk boundaries (adjacent spans at chunk edges may need joining)

### TypeScript-Only Architecture
- **All detection in the API process:** Rampart runs via `@nationaldesignstudio/rampart` npm package, in-process. No HTTP call to a separate worker.
- **All product logic in TypeScript:** Run lifecycle, span decisions, pseudonymisation, output generation, audit logging, UK supplement, span merging. No Python anywhere in the redaction stack.

### Storage
Redaction runs stored in PostgreSQL. Spans stored as JSONB array within the run (simpler than a separate spans table for Phase 1). Output artifacts go to the existing `artifacts` table with type `redaction_report`.

### Desktop-Local
M1 is hosted-only (API). Desktop-local redaction is M3+ scope. The `syncState: 'local_only'` enum exists, but the Electron local processing path is not in the first 3 months. Firms can use the hosted version first. Rampart's client-side capability makes this a natural future extension since the same npm package runs in the browser.

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
  source: SpanSource             // which layer detected it
  confidence: 'high' | 'medium' | 'low'
  suggestion: 'redact' | 'pseudonymise' | 'keep'
}

type SpanSource =
  | 'rampart_model'          // Rampart token-classification model
  | 'rampart_deterministic'  // Rampart regex + checksum recognizer
  | 'uk_supplement'           // Obiter UK legal-specific regex

type SpanCategory =
  | 'person_name'           // rampart_model: GIVEN_NAME + SURNAME
  | 'email'                 // rampart_deterministic: EMAIL
  | 'phone'                 // rampart_model: PHONE
  | 'address'               // rampart_model: BUILDING_NUMBER + STREET_NAME + SECONDARY_ADDRESS
  | 'government_id'         // rampart_mix: SSN, GOVERNMENT_ID, TAX_ID
  | 'account_number'        // rampart_mix: CREDIT_CARD, BANK_ACCOUNT, ROUTING_NUMBER
  | 'passport'              // rampart_model: PASSPORT
  | 'drivers_license'        // rampart_model: DRIVERS_LICENSE
  | 'url'                   // rampart_deterministic: URL
  | 'ip_address'            // rampart_deterministic: IP_ADDRESS
  | 'national_insurance'    // uk_supplement: UK NI number
  | 'case_reference'        // uk_supplement: internal firm/matter ref
  | 'organisation_name'     // uk_supplement: firm/company name
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
Creates the run, triggers detection. The API calls `guard.protect(text)` in-process. Status transitions: pending -> detecting -> ready_for_review. If detection fails, status goes to `failed` with a reason.

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
      bySource: { rampartModel: number, rampartDeterministic: number, ukSupplement: number }
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
  'person_name', 'email', 'phone', 'address', 'government_id',
  'account_number', 'passport', 'drivers_license', 'url', 'ip_address',
  'national_insurance', 'case_reference', 'organisation_name',
])

export const spanSourceSchema = z.enum(['rampart_model', 'rampart_deterministic', 'uk_supplement'])

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
// 'redaction_already_finalized', 'redaction_detection_failed'
```

## Package Structure

### `packages/redaction-policy/` (TypeScript)
Pure TypeScript logic for: UK supplement regex, span merging, Rampart label mapping, pseudonymisation, output generation. No framework dependencies. Testable in isolation.

```
packages/redaction-policy/
  src/
    index.ts           - public API
    rampart-map.ts      - maps Rampart span output to Obiter span categories
    supplement.ts       - regex patterns for UK legal-specific PII (NI, case refs, organisation names)
    merge.ts            - merge Rampart spans + UK supplement spans, deduplicate overlaps
    chunk.ts             - split long text into 512-token chunks, reassemble span offsets
    pseudonym.ts        - consistent token assignment
    apply.ts            - apply decisions to text, produce redacted/pseudonymised output
    types.ts            - RedactionSpan, SpanCategory, etc.
    index.test.ts       - test fixtures with real legal text
```

### `services/api/src/routes/redact.ts`
API route handlers. Follows the existing pattern in `routes/matters.ts` and `routes/documents.ts`: `createRedactRoutes(pool)` returns a Hono instance, mounted in `app.ts`.

### `services/api/src/redaction-database.ts`
Database functions for redaction runs. Follows the pattern of `database.ts`: typed query helpers, not inline SQL in routes.

### `services/api/src/redaction-detection.ts`
Rampart integration module. Loads the `@nationaldesignstudio/rampart` guard, calls `guard.protect(text)`, maps Rampart spans to Obiter categories, runs UK supplement, merges. Handles chunking for long documents.

**Rampart guard lifecycle:**
- The guard is loaded once and cached as a module-level singleton. First request loads the model (14.7 MB, downloads from HuggingFace if not cached, ~1-2 seconds). Subsequent requests reuse the cached guard.
- No health check endpoint needed (in-process, no separate service).

### `packages/app-shell/src/redact/`
Review UI components (M2). Follows existing app-shell patterns: shared between web and desktop, TanStack Query for server state, Zustand for local UI state.

## Weekly Plan (12 Weeks / 3 Months)

### Week 1-2: Rampart Integration + Foundation

**Goal:** Rampart running in the API process, schema, contracts, API skeleton, UK supplement.

- [ ] Add `@nationaldesignstudio/rampart` and `@huggingface/transformers` to `services/api/package.json`
- [ ] Create `services/api/src/redaction-detection.ts`:
  - Load Rampart guard via `createGuard({ device: 'cpu' })`
  - Implement `detectPII(text)` that calls `guard.protect(text)`, maps Rampart labels to Obiter categories
  - Handle 512-token chunking for long documents (split, detect per chunk, adjust offsets, merge)
  - Cache the guard instance at module level (singleton, loaded once)
- [ ] Write migration `0005_redaction.sql` (DDL above)
- [ ] Add redaction contracts to `packages/contracts/src/index.ts`
- [ ] Add new error codes to `apiErrorCodeSchema` (including `redaction_detection_failed`)
- [ ] Create `packages/redaction-policy/` with `package.json`, `tsconfig.json`
- [ ] Implement `types.ts` with all interfaces (RedactionSpan, SpanCategory, SpanSource, etc.)
- [ ] Implement `rampart-map.ts`: map Rampart labels (GIVEN_NAME, SURNAME, PHONE, EMAIL, URL, etc.) to Obiter categories
- [ ] Implement `supplement.ts` with regex patterns for: NI numbers, case references, organisation names
- [ ] Implement `merge.ts`: merge Rampart spans + UK supplement spans, deduplicate overlaps (Rampart wins on confidence)
- [ ] Implement `chunk.ts`: split text into 400-token chunks, run detection per chunk, adjust offsets to document level, handle spans at chunk boundaries
- [ ] Write rampart-map, supplement, merge, and chunk tests with realistic legal text fixtures
- [ ] Scaffold `services/api/src/routes/redact.ts` with `createRedactRoutes(pool)`
- [ ] Create `services/api/src/redaction-database.ts` with query helpers
- [ ] Mount redact routes in `app.ts`
- [ ] Implement `POST /api/documents/:documentId/redaction-runs` (create run, call detection, merge spans, store, return run)

**Milestone M1 (partial): Rampart running in-process, text extraction + first detection run works.**

### Week 3-4: Run Lifecycle + Decisions

**Goal:** Full run lifecycle API, span decisions, audit logging, detection failure handling.

- [ ] Implement `GET /api/redaction-runs/:runId` (return run with spans, decisions, summary)
- [ ] Implement `POST /api/redaction-runs/:runId/spans/:spanId/decision` (update decisions_json, audit log)
- [ ] Implement `GET /api/documents/:documentId/redaction-runs` (list runs)
- [ ] Add status transitions: `pending -> detecting -> ready_for_review -> reviewing -> finalized`
- [ ] Auto-transition to `reviewing` when first decision is submitted
- [ ] Handle detection failures: if Rampart throws or model load fails, set status to `failed`, record `failure_reason`
- [ ] Audit log entries: `redaction.run_create`, `redaction.span_decision`, `redaction.finalize`
- [ ] Add `redaction.run_create`, `redaction.span_decision`, `redaction.finalize` to the `AuditRecordInput` action union in `database.ts`
- [ ] API tests: create run, get run, submit decisions, verify state changes
- [ ] Error handling: run not found, span not found, run already finalized, run not in reviewable state, detection failed

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
- [ ] Document text view with highlighted spans (color by category, distinguish Rampart model vs deterministic vs UK supplement by border style)
- [ ] Span list panel: sortable by category, confidence, source, review status
- [ ] Click span -> highlight in document view, show decision buttons
- [ ] Decision actions: accept, reject, override to redact, override to keep, pseudonymise
- [ ] Summary bar: X spans, Y reviewed, Z unreviewed, breakdown by source (Rampart model vs deterministic vs UK supplement)
- [ ] Policy mode selector (internal AI minimisation vs external sharing) on run creation
- [ ] Finalize button with output mode selector (redacted vs pseudonymised)
- [ ] TanStack Query: `useRedactionRun`, `useSpanDecision`, `useFinalizeRun`
- [ ] Route: `/matters/:matterId/documents/:documentId/redact/:runId` (or `/redaction-runs/:runId`)
- [ ] Sidebar: change "Redaction" entry from `status: 'planned'` to active link
- [ ] Empty states: no runs yet, no spans detected, all spans reviewed
- [ ] Loading states: detection in progress (Rampart scanning), finalizing

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
  - detector version (Rampart model version + npm package version)
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
  - Overlapping spans (Rampart wins over UK supplement on confidence)
  - Empty text
  - Text with no detectable PII (0 spans, valid run)
  - All spans rejected (finalized with no changes)
  - Finalize without reviewing all spans (allowed but warn)
  - Re-run redaction on same document (new run, new spans)
  - Detection failure (Rampart model load error, run goes to `failed`)
  - Very long document (chunking, > 512 tokens)
- [ ] Type-check everything: `pnpm --filter @obiter/redaction-policy typecheck`, `pnpm --filter @obiter/api typecheck`, `pnpm --filter @obiter/app-shell typecheck`
- [ ] Run all tests: `pnpm --filter @obiter/redaction-policy test`, `pnpm --filter @obiter/api test`
- [ ] Update `docs/current-product-scope.md`: move Redaction from "Visible But Not Implemented" to implemented navigation
- [ ] Update `docs/specs/redact/milestones.md` with completion notes

**Milestone M3 (complete): pseudonymised and redacted export works, audit log export works.**

## What's NOT In Scope (First 3 Months)

- PDF-safe redaction (needs PDF manipulation beyond text replacement)
- Rampart fine-tuning on legal text (the pipeline is built, fine-tuning is post-MVP when we have evaluation fixtures)
- Desktop-local redaction (Electron offline path)
- Batch redaction (multiple documents at once)
- Redaction policy customization (firm-specific rules)
- BullMQ job queue (synchronous detection in-process is fine for single documents; queue comes for batch processing)
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
| Object storage for text/output | Not wired (verified July 2026): no storage client exists in the API and document upload is metadata-only — no file bytes reach the server. M1–M2 run on a `StorageService` abstraction with a local-filesystem adapter (introduced in Redact PRD 1 for fallback-text persistence); M3 adds multipart content upload and the object-storage adapter (Redact PRD 3, FR1.11–FR1.12) |
| `@nationaldesignstudio/rampart` npm package | Not yet installed. Add to `services/api/package.json` |
| `@huggingface/transformers` npm package | Not yet installed. Add to `services/api/package.json` (peer dep of Rampart) |

**Risk (confirmed):** Object storage is not wired — document upload creates the DB record only and no file bytes are stored anywhere (verified July 2026). M1 uses the `StorageService` local-filesystem adapter as interim, persisting fallback text at the `text_object_key` path so M2's finalize can re-read it; the object-storage adapter and multipart upload land in M3.

**Risk:** First request after API restart loads the Rampart model (14.7 MB download from HuggingFace if not cached, then model initialization). This may add 2-5 seconds to the first detection request. Mitigation: warm the guard on API startup, or accept the delay on first request and document it.

## Verification

Per TESTING.md, redaction is a high-risk area. Required testing:

- **Detection tests:** fixture-based, covering each span category with real legal text, edge cases (UK NI number format, name prefixes, international phone numbers)
- **Rampart integration tests:** verify Rampart returns correct spans for known PII patterns, verify API handles detection failures gracefully
- **Chunking tests:** verify long documents (> 512 tokens) are split, detected per chunk, and offsets reassembled correctly
- **Span merge tests:** verify Rampart + UK supplement spans merge correctly, overlaps resolved by confidence
- **Decision persistence tests:** create run, submit decisions, reload run, verify decisions intact
- **Output safety tests:** assert no PII strings appear in redacted output, assert pseudonymised tokens are consistent
- **Audit log tests:** verify every action (run create, span decision, finalize) produces an audit record
- **API error tests:** run not found, span not found, already finalized, not reviewable, wrong org, detection failed
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
3. System detects PII using Rampart (context-aware, not regex): names, addresses, emails, phone numbers, accounts, government IDs, passports, URLs, IP addresses. Plus UK legal-specific patterns from the supplement: NI numbers, case references, organisation names
4. Review each detection: accept, reject, override, or pseudonymise. Spans are tagged by source so the reviewer can see which came from the Rampart model vs the deterministic layer vs the UK supplement
5. Finalize: produce a redacted version and a pseudonymised version
6. Download the redacted document and an audit report showing every decision, who made it, when, the policy mode, and the detector version used

This is something a firm can:
- Inspect the audit trail
- Verify no PII leaks in the redacted output
- Pseudonymise for internal AI use
- Trust the process is conservative (human review required, no auto-signoff)
- Verify the detection engine is a real model (Rampart, 18.5M params, 98.42% recall), not pattern matching
