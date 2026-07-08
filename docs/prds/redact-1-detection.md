# Redact PRD 1: Detection Pipeline Foundation

## Summary

Redact is Ormont's confidentiality and privacy layer. It detects personally identifiable information (PII) and secrets in matter documents, applies legal-specific redaction policy, supports pseudonymisation, and produces audited outputs with human review checkpoints.

This phase builds the detection pipeline end-to-end: Rampart (14.7 MB ONNX token-classification model, 18.5M params, CC BY 4.0) running in-process in the Hono API via Transformers.js, the database schema for redaction runs, a TypeScript UK supplement for legal-specific patterns, a span merging engine, and the API skeleton for run creation and lifecycle. After Phase 1, a user can upload a document, trigger a redaction run, and see detected spans ready for review.

Follow-on work is defined in sibling PRDs:
- [Redact PRD 2: Review and Output](redact-2-review-output.md): span review UI, decision submission, pseudonymisation, output generation, finalization.
- [Redact PRD 3: Production Readiness](redact-3-production.md): DOCX extraction, audit report export, demo fixture, end-to-end testing, edge case handling.

See the detailed implementation at [docs/specs/redact/build-plan.md](../specs/redact/build-plan.md).

Shared contracts live in `packages/contracts`. Redaction policy logic lives in `packages/redaction-policy`.

## Problem

Before legal AI can process a matter document, the document must be safe. Client data: names, addresses, phone numbers, email addresses, dates of birth, national insurance numbers, passport numbers, bank account details, internal case references: must be detected and either removed or pseudonymised before the document enters any AI pipeline, is shared with external counsel, or generates an output artifact.

Current approaches are inadequate:

- **Regex-only detection** misses context-dependent PII (e.g. distinguishing "Mr Smith is the claimant" from "Smith v Jones is a citation"). It produces high false-positive rates that destroy review trust.
- **Closed-source redaction APIs** send client data to third-party servers, which many law firms and compliance departments prohibit.
- **Rule-based systems** require expensive manual configuration per firm and per document type.
- **Manual redaction** does not scale. A 200-page disclosure bundle reviewed by associates at £300/hour is neither fast nor consistent.

Rampart solves the detection problem: it is open-weight (CC BY 4.0), runs fully in-process via Transformers.js (no data leaves the server), understands context (it is a MiniLM-L6-H384 token classifier with a 35-label BIO head, not a regex engine), and achieves 98.42% private-term recall on the OpenPII 30k held-out test set. It ships with a built-in deterministic recognizer layer (regex + checksum for SSN, credit cards, email, URL, IP). But it has gaps for UK legal text: national insurance numbers, case references, and organisation names are not in its label set, and its 17 entity types must be mapped to Ormont's span category model.

This PRD exists to close the gap between "a model that detects PII" and "a production redaction service that firms can verify."

## Product Principles

- **Detection must be context-aware, not pattern-only.** The system must distinguish a person name in a narrative from a party name in a case citation.
- **All detection runs in-process.** No document content ever leaves the API server's memory or storage for detection. No external service call, no Python worker, no Docker container.
- **Model output is a first pass, not a final answer.** Every detected span is a suggestion. Human review is required before any output is trusted.
- **UK legal-specific patterns supplement the model.** National Insurance numbers, case references, and organisation names are known fixed-format or suffix-based patterns that the model does not cover; the UK supplement catches them explicitly.
- **Rampart wins on overlap.** When both Rampart and the UK supplement detect the same span, Rampart's confidence and category assignment take precedence.
- **Spans are suggestions with confidence scores, not immutable judgments.** Every span carries a category, confidence level, and suggested action. Reviewers can accept, reject, override, or pseudonymise each one.
- **The run lifecycle is explicit and auditable.** Every status transition and decision is recorded in the audit log.
- **Spans are stored as a JSONB array within the run.** A separate spans table is unnecessary for Phase 1; the run record contains everything needed for review.
- **The detection module does one thing well.** It runs Rampart inference, maps labels, runs the supplement, and merges. No business logic, no database access in the detection module itself.

## Goals

- Run Rampart in-process in the Hono API via `@nationaldesignstudio/rampart` and `@huggingface/transformers`, processing text on CPU (no GPU required).
- Map Rampart's 17 entity types + 5 deterministic labels to Ormont's 15 span categories. (`secret` is schema-only in Phase 1: no detector emits it until fine-tuning adds coverage.)
- Store redaction runs in PostgreSQL with full foreign-key relationships to matters, documents, and document versions.
- Implement TypeScript regex patterns for UK National Insurance numbers, case references, and organisation names.
- Merge Rampart spans with UK supplement spans, deduplicating overlaps with Rampart winning on confidence.
- Handle long documents (> 512 tokens) via chunking, per-chunk detection, and offset reassembly.
- Provide `POST /api/documents/:documentId/redaction-runs` to create a run, trigger detection, and store results.
- Provide `GET /api/redaction-runs/:runId` to retrieve a run with spans, decisions, and summary.
- Provide `GET /api/documents/:documentId/redaction-runs` to list runs for a document.
- Handle detection failures gracefully: set run status to `failed` with a descriptive reason.
- Add redaction contracts (span category, source, status, policy mode schemas) and error codes to `packages/contracts`.

## Non-Goals

- No span review UI in Phase 1. Review is Phase 2.
- No span decision submission in Phase 1. Decisions are Phase 2.
- No pseudonymisation or output generation in Phase 1. Output generation is Phase 2.
- No DOCX or PDF text extraction in Phase 1. Phase 1 works with plain text only. DOCX extraction is Phase 3.
- No desktop-local redaction path. Desktop-only mode is post-MVP.
- No PDF-safe redaction in Phase 1. PDF handling is a separate workstream.
- No fine-tuning of the Rampart model in Phase 1. Fine-tuning is post-MVP when sufficient legal-domain training data exists.
- No batch processing or queue-based architecture. Phase 1 is synchronous request-response for simplicity.
- No vector search or semantic retrieval for span detection. Rampart is a token-classification model, not a retrieval system.

## Users

### Legal Professional (Reviewer)

A solicitor, paralegal, or compliance officer who needs to review detected PII spans in a matter document, accept or reject each span, and produce a clean output for sharing or AI processing. In Phase 1, this user can create a redaction run and see detected spans. Review actions arrive in Phase 2.

### Firm Administrator

Responsible for policy configuration: which categories are redacted, pseudonymised, or kept for internal AI minimisation versus external sharing. Policy modes are stored in Phase 1; policy customisation is post-MVP.

### Builder Or Integrator

A developer integrating Ormont Redact into a firm's document workflow. Needs stable API contracts, predictable error codes, and the ability to automate redaction run creation. Phase 1 provides the create-run and get-run endpoints.

## Core Use Cases

1. Legal professional uploads a document, triggers a redaction run, and sees all detected PII spans organised by category, source, and confidence.
2. System detects person names, dates, phone numbers, email addresses, URLs, IP addresses, credit cards, bank accounts, government IDs, passports, driver's licenses, and address components via Rampart.
3. System detects UK National Insurance numbers, case references, and organisation names via the UK supplement.
4. Overlapping spans from Rampart and the supplement are merged; Rampart-assigned categories and confidence take precedence.
5. System records the detector version (Rampart model version + npm package version) and detection metadata for auditability.
6. System handles detection failure gracefully, recording the failure reason and leaving the run in a `failed` state for retry.
7. Legal professional can see a summary of detected spans grouped by category and source before beginning review.

## Scope

Phase 1 delivers the detection pipeline and API skeleton. Everything needed to go from "document has text" to "spans detected and stored, ready for human review."

### In Scope

- Rampart integration in the API process (`services/api/src/redaction-detection.ts`) via `@nationaldesignstudio/rampart` npm package.
- Rampart guard lifecycle: model loads on first request, cached at module level for subsequent requests.
- Effect TS pilot, contained to the detection module behind a promise facade (see Effect TS Pilot section; F31).
- Rampart label-to-Ormont-category mapping (`packages/redaction-policy/src/rampart-map.ts`).
- Database migration `0005_redaction.sql` creating the `redaction_runs` table.
- Redaction contracts in `packages/contracts`: span categories, sources, statuses, policy modes, error codes.
- Redaction policy package (`packages/redaction-policy/`) with types, UK supplement, span merging, and chunking.
- API routes: create run, get run, list runs for document.
- Database helpers for run CRUD (`redaction-database.ts`).
- Minimal `StorageService` abstraction (local filesystem adapter) used to persist fallback text at the `text_object_key` path (see Open Question 7). Phase 2 reuses it for output artifacts; Phase 3 adds the object-storage adapter.
- Migration runner (`scripts/migrate.ts`, `pnpm migrate`): applies `packages/database/migrations/*.sql` in order with a `schema_migrations` tracking table — no runner exists today and `0005_redaction.sql` must be appliable repeatably (locally, in tests, and as the API container pre-start step per [docs/specs/deployment.md](../specs/deployment.md)). The API Dockerfile is also this track's deliverable per that spec.
- Audit log entries for redaction run creation (extends the `AuditRecordInput` action union in `services/api/src/database.ts` with `redaction.run_create`).
- Detection failure handling and run status transitions (`pending -> detecting -> ready_for_review | failed`).
- The run summary computation (span counts by category and source).
- Chunking for documents exceeding Rampart's 512-token max sequence.

### Out Of Scope (Phase 1)

- Span review UI and decision submission (Phase 2).
- Output generation (redacted or pseudonymised text) (Phase 2).
- DOCX or PDF extraction (Phase 3).
- PDF-safe redaction (separate workstream).
- Fine-tuning the Rampart model.
- Batch processing queue.
- Desktop-local detection path.
- Policy customisation per organisation.
- Automated sign-off or no-review finalization.

## Detection Architecture

### Three-Layer Detection Strategy

Redact uses three detection layers in sequence:

1. **Rampart deterministic recognizer (built-in):** Regex + checksum for SSN, credit card, email, URL, IP address. Runs first, masks structured identifiers to sentinel tokens before the model sees the text. Near-100% recall on these classes. Part of the `@nationaldesignstudio/rampart` package.

2. **Rampart token-classification model (built-in):** MiniLM-L6-H384 encoder fine-tuned with a 35-label BIO head (17 entity types). Context-aware: it understands that "Smith" in "Smith v Jones" is a citation, not a person to redact. Runs on CPU via ONNX Runtime. Returns spans with entity labels. Part of the `@nationaldesignstudio/rampart` package.

3. **Ormont UK supplement (`packages/redaction-policy/src/supplement.ts`):** TypeScript regex patterns for UK legal-specific identifiers that Rampart does not cover. Runs in the API process after Rampart returns.

### Rampart Output Mapping

Rampart outputs BIO token tags for 17 entity types. These are decoded into contiguous character spans and mapped to Ormont's category set:

| Rampart Label | Ormont Category | Source |
|---|---|---|
| `GIVEN_NAME` + `SURNAME` | `person_name` | `rampart_model` |
| `PHONE` | `phone` | `rampart_model` |
| `PASSPORT` | `passport` | `rampart_model` |
| `DRIVERS_LICENSE` | `drivers_license` | `rampart_model` |
| `DATE` + `DOB` | `date` | `rampart_model` |
| `BUILDING_NUMBER` + `STREET_NAME` + `SECONDARY_ADDRESS` | `address` | `rampart_model` |
| `EMAIL` | `email` | `rampart_deterministic` |
| `URL` | `url` | `rampart_deterministic` |
| `IP_ADDRESS` | `ip_address` | `rampart_deterministic` |
| `CREDIT_CARD` + `BANK_ACCOUNT` + `ROUTING_NUMBER` | `account_number` | `rampart_mix` |
| `SSN` + `GOVERNMENT_ID` + `TAX_ID` | `government_id` | `rampart_mix` |

The label strings in this table are indicative. The exact Rampart label names (including whether dates of birth are emitted as a distinct `DOB` label or folded into `DATE`) MUST be verified against the `@nationaldesignstudio/rampart` package at implementation time, before `rampart-map.ts` is written. The mapping module MUST fail loudly (typed error at load time) on an unrecognised label rather than silently dropping spans.

### Rampart Spike Results (run July 2026 — plan owner)

The mandated pre-implementation spike was executed against `@nationaldesignstudio/rampart` 0.1.3 under Node.js. Findings, which are binding on the detection module:

1. **Node.js works.** `createGuard({ device: 'cpu' })` initialises server-side (guard ready in ~2.8s cold including model load; inference ~16ms per call). No browser-only APIs. The browser-only fallback plan is not needed.
2. **`guard.protect()` is the wrong API for this product.** It returns `{ text, placeholders }` — masked text with reversible placeholders — not character-offset spans. Span-level detection uses the package's lower-level exports: `detectHeuristics(text)` (deterministic layer) and `detectNer(text, classifier)` with `loadNerClassifier({ device: 'cpu' })`. Both return spans shaped `{ start, end, label, score, source: 'heuristic' | 'ner', text }`, which map directly to Ormont spans (`heuristic` → `rampart_deterministic`, `ner` → `rampart_model`).
3. **The real model label space (17, from the model config's `id2label`):** `BANK_ACCOUNT`, `BUILDING_NUMBER`, `CITY`, `DRIVERS_LICENSE`, `EMAIL`, `GIVEN_NAME`, `GOVERNMENT_ID`, `PASSPORT`, `PHONE`, `ROUTING_NUMBER`, `SECONDARY_ADDRESS`, `STATE`, `STREET_NAME`, `SURNAME`, `TAX_ID`, `URL`, `ZIP_CODE`. The heuristic layer emits `EMAIL`, `URL`, `IP_ADDRESS`, `CREDIT_CARD`, `SSN`. Consequences:
   - `CITY`, `STATE`, `ZIP_CODE` exist and fire on virtually every UK address — they map to `address` (added to `rampart-map.ts`).
   - **`DATE` and `DOB` do not exist.** The base model detects no dates at all. Date and date-of-birth detection therefore falls to the UK supplement in v1 (see F20) and to fine-tuning later; the map retains DATE/DOB entries so a future checkpoint that emits them maps correctly.
4. **Pipeline ordering matters.** Running NER on raw text produced a bleed artifact (a `PHONE` span swallowing part of an adjacent card number). The detection module MUST mirror the guard's internal order: run `detectHeuristics` first, mask those spans (`premask` / `projectMaskedSpan` are exported), then run NER, then merge — never NER on raw unmasked text.

### UK Supplement Patterns

The UK supplement catches patterns Rampart does not cover:

| Ormont Category | Pattern | Example |
|---|---|---|
| `national_insurance` | `[A-Z]{2}\d{6}[A-Z]` (with/without spaces) | QQ123456C |
| `case_reference` | Flexible pattern for firm-specific reference formats | `2024/ABC/123`, `CR-2024-00123` |
| `organisation_name` | Suffix-based: LLP, Ltd, plc, Solicitors, Chambers | Smith & Jones Solicitors LLP |

### Span Merging Rules

The merge function in `packages/redaction-policy/src/merge.ts` applies these rules:

1. Both span sets are sorted by character start position.
2. If two spans overlap (one starts before the other ends), the Rampart span's category and confidence are kept; the UK supplement span is discarded.
3. If a UK supplement span exactly matches a Rampart span in position, the Rampart span wins.
4. Spans with zero length (`start === end`) are discarded.
5. The output is a deduplicated, sorted array of `RedactionSpan` objects.

### Chunking for Long Documents

Rampart has a 512-token max sequence length. Documents exceeding this must be chunked:

1. Text is split into chunks of approximately 400 tokens (leaving room for special tokens).
2. Detection runs on each chunk independently.
3. Span character offsets are adjusted back to document-level coordinates by adding the chunk's start offset.
4. Spans at chunk boundaries (a span that would be split across two chunks) are handled by overlapping chunks by 50 tokens on each side, then deduplicating spans that appear in the overlap region.

### Rampart Guard Lifecycle

The Rampart guard is loaded once and cached as a module-level singleton in `services/api/src/redaction-detection.ts`. First request loads the model (14.7 MB, downloads from HuggingFace if not cached on disk, then initializes the ONNX Runtime). Subsequent requests reuse the cached guard. No health check endpoint is needed since detection runs in-process. No Docker container, no separate service.

### Effect TS Pilot (contained to the detection module)

The detection module is a deliberate, contained pilot of Effect TS (`effect` npm package), decided July 2026. Rationale: the module is greenfield, isolated, and Effect-shaped — a typed failure channel (model load vs inference vs timeout), resource lifecycle around the model guard, and retry/timeout policy — making it the cheapest place to gather real evidence on whether agent-written Effect meets the project's maintainability bar, instead of settling the question by assertion.

**Containment rules:**

- Effect is used inside `services/api/src/redaction-detection.ts` (and its internal helpers) only.
- The module's public API is promise-based (e.g. `detectSpans(text: string): Promise<DetectionResult>`). Callers never see Effect types; `Effect.runPromise` happens exactly once, at the facade.
- Typed failures (`model_load_failed`, `inference_failed`, `detection_timeout`) live in the Effect error channel internally and surface through the facade as the typed error F6 requires; the route maps them to `redaction_detection_failed` exactly as specced. Nothing about the API contract changes.
- `packages/contracts` stays Zod. `packages/redaction-policy` stays plain TypeScript (pure functions gain nothing from Effect). No module outside detection imports `effect`.

**Exit criteria** (assessed at the Phase 1 review by the plan owner):

1. Idiom quality: no `runPromise`/`runSync` inside the pipeline, failures never escape the typed channel, guard acquisition/caching expressed with Effect resource primitives — verified in code review.
2. Test quality: all failure paths (load failure, inference error, timeout, empty input) tested through the typed channel, at minimum parity with what plain-TS tests would cover.
3. Delivery drag: the module lands within the Phase 1 window without disproportionate review cycles relative to the rest of the phase.

**Decision gate:** pass → Effect becomes a candidate for Phase 2's finalize transaction flow and the post-MVP worker/ingestor services, each expansion with its own containment plan. Fail → the module is rewritten in plain TypeScript behind the same promise facade (a one-module rewrite by construction), and the outcome is recorded in `docs/architecture.md`. Either way the question gets a documented, evidence-based answer.

### Run Status Flow

```
pending -> detecting -> ready_for_review (success)
pending -> detecting -> failed (detection error or model load failure)
```

Status transitions:
- `pending`: Run record created in database. No detection started.
- `detecting`: API has called `guard.protect(text)` and is awaiting response. Set before the call, not after.
- `ready_for_review`: Rampart returned spans. UK supplement ran. Merging complete. Spans stored in `spans_json`. Run ready for human review.
- `failed`: Rampart threw an error, model failed to load, or detection timed out. `summary_json.failure_reason` contains a human-readable description. Users can retry by creating a new run.

## Functional Requirements

### Rampart Detection Integration (F1-F8)

- **F1.** The detection module MUST load the Rampart NER classifier via `loadNerClassifier({ device: 'cpu' })` from `@nationaldesignstudio/rampart` and cache it at module level as a singleton. (Corrected from `createGuard` per the Rampart Spike Results — the guard's `protect()` returns placeholders, not spans.)
- **F2.** The detection module MUST produce character-offset spans by running `detectHeuristics(text)` first, masking those spans before NER (`premask`/`projectMaskedSpan`), then `detectNer(maskedText, classifier)` with offsets projected back to the original text, then merging — never NER on raw unmasked text (see Rampart Spike Results, finding 4).
- **F3.** The detection module MUST map Rampart entity labels to Ormont span categories per the mapping table above.
- **F4.** The detection module MUST handle empty text input: return `{ spans: [] }` without error.
- **F5.** The detection module MUST chunk documents exceeding 512 tokens, run detection per chunk, adjust offsets, and merge results.
- **F6.** The detection module MUST handle model load failures: throw a typed error that the route handler catches and maps to `redaction_detection_failed`.
- **F7.** The detection module MUST record the Rampart model version and npm package version as `detector_version`.
- **F8.** The detection module MUST log inference time and text length for each detection request to stdout for monitoring.

### Database Schema (F9-F14)

- **F9.** The migration `0005_redaction.sql` (in `packages/database/migrations/`, following the existing numbering) MUST create the `redaction_runs` table with columns: `id` (text, `red_` prefix), `organisation_id`, `matter_id`, `document_id`, `document_version_id`, `status` (enum via check constraint), `policy_mode` (enum via check constraint), `spans_json` (JSONB, default `[]`), `decisions_json` (JSONB, default `{}`), `output_artifact_id` (text, nullable, references `artifacts(id)`), `summary_json` (JSONB, default `{}`), `detector_version` (text, nullable), `created_by` (references `users(id)`), `created_at`, `updated_at`.
- **F10.** The status check constraint MUST permit exactly: `'pending'`, `'detecting'`, `'ready_for_review'`, `'reviewing'`, `'finalized'`, `'failed'`.
- **F11.** The policy mode check constraint MUST permit exactly: `'internal_ai_minimisation'`, `'external_sharing'`.
- **F12.** Foreign key constraints MUST reference: `matters(id, organisation_id)`, `matter_documents(id, matter_id, organisation_id)`, `document_versions(id, matter_document_id, matter_id, organisation_id)`.
- **F13.** Indexes MUST exist on: `(matter_id)`, `(document_id)`, `(status)`, `(organisation_id, matter_id)`.
- **F14.** The `summary_json` field MUST store computed summary data: `totalSpans`, `byCategory` (record of category to count), `bySource` (`{ rampartModel: number, rampartDeterministic: number, ukSupplement: number }`), `reviewedCount` (0 initially), `unreviewedCount` (equals totalSpans initially), and optionally `failureReason` (string) for failed runs.

### Contracts (F15-F17)

- **F15.** The following Zod schemas MUST be added to `packages/contracts/src/index.ts`:
  - `spanCategorySchema`: enum of 15 values (`person_name`, `email`, `phone`, `address`, `date`, `government_id`, `account_number`, `passport`, `drivers_license`, `url`, `ip_address`, `national_insurance`, `case_reference`, `organisation_name`, `secret`). `secret` is schema-only in Phase 1: no detector emits it, but downstream phases (review UI, synthetic data, fine-tuning) rely on it existing in the contract.
  - `spanSourceSchema`: enum (`rampart_model`, `rampart_deterministic`, `uk_supplement`).
  - `redactionRunStatusSchema`: enum (`pending`, `detecting`, `ready_for_review`, `reviewing`, `finalized`, `failed`).
  - `redactionPolicyModeSchema`: enum (`internal_ai_minimisation`, `external_sharing`).
  - `spanConfidenceSchema`: enum (`high`, `medium`, `low`).
  - `spanSuggestionSchema`: enum (`redact`, `keep`). (Pseudonymisation is a reviewer decision, not a detector suggestion — see `spanDecisionSchema`.)
  - `spanDecisionSchema`: enum (`accept`, `reject`, `override_redact`, `override_keep`, `pseudonymise`).
  - `outputModeSchema`: enum (`redacted`, `pseudonymised`).
- **F16.** The following error codes MUST be added to `apiErrorCodeSchema`:
  - `redaction_run_not_found`: Run ID does not exist or is not accessible in the organisation scope.
  - `span_not_found`: Span ID does not exist within the specified run.
  - `redaction_run_not_reviewable`: Run is not in a state that allows review operations (not `ready_for_review` or `reviewing`).
  - `redaction_already_finalized`: Run has already been finalized and cannot be modified.
  - `redaction_detection_failed`: The detection process failed (model load error, inference error, or timeout).
  - `redaction_span_integrity_error`: Finalize aborted because a span's stored text did not match the document text at its recorded offsets. Finalize is fail-closed: output is never produced with silently skipped redactions (used in Phase 2).
- **F17.** TypeScript types MUST be exported for each schema (e.g. `SpanCategory`, `RedactionRunStatus`, etc.) using `z.infer`.

### Redaction Policy Package (F18-F23)

- **F18.** `packages/redaction-policy/src/types.ts` MUST export:
  - `RedactionSpan`: `{ id: string, start: number, end: number, text: string, category: SpanCategory, source: SpanSource, confidence: SpanConfidence, suggestion: SpanSuggestion }`.
  - `SpanCategory`, `SpanSource`, `SpanConfidence`, `SpanSuggestion`, `SpanDecision` (all `z.infer<>` from contracts or standalone enums).
  - `Decisions`: `Record<string, { decision: SpanDecision, decidedBy: string, decidedAt: string }>`.
  - `RunSummary`: `{ totalSpans: number, byCategory: Record<SpanCategory, number>, bySource: { rampartModel: number, rampartDeterministic: number, ukSupplement: number }, reviewedCount: number, unreviewedCount: number }`.
- **F19.** `rampart-map.ts` MUST export `mapRampartSpans(rampartOutput: RampartOutput): RedactionSpan[]` that converts Rampart entity labels and offsets to Ormont span categories.
- **F20.** `supplement.ts` MUST export `supplementSpans(text: string): RedactionSpan[]` that applies regex patterns for UK National Insurance numbers, case references, and organisation names — **plus dates** (added July 2026: the spike proved the base model emits no date labels, so date detection is supplement work in v1): legal-format dates (`15 March 2024`, `the 15th day of March 2024`, `15/03/2024`) as category `date` with suggestion `keep`, and dates in a date-of-birth context (preceded by phrases like `born on`, `date of birth`, `DOB`) as category `date` with suggestion `redact`.
- **F21.** `merge.ts` MUST export `mergeSpans(rampartSpans: RedactionSpan[], supplementSpans: RedactionSpan[]): RedactionSpan[]` that:
  - Sorts both arrays by `start` position.
  - For overlapping spans, keeps the Rampart span and discards the supplement span.
  - For non-overlapping spans, preserves both.
  - Assigns suggestions based on category: `person_name`, `email`, `phone`, `address`, `government_id`, `account_number`, `passport`, `drivers_license`, `national_insurance`, `ip_address`, `secret` default to `redact`; `url`, `case_reference`, `organisation_name` default to `keep` (reviewer decides).
  - `date` spans default to `keep`, EXCEPT spans originating from a date-of-birth label (`DOB` or equivalent), which default to `redact`. Legal documents are saturated with structural dates (hearing dates, filing deadlines, judgment dates) that are load-bearing and must not be redacted; suggesting `redact` for every date would flood reviewers with false positives — the exact review-trust failure mode this product exists to avoid. Dates of birth are genuine PII and keep the `redact` default.
- **F22.** `chunk.ts` MUST export `chunkText(text: string, maxTokens?: number): TextChunk[]` and `reassembleSpans(chunkedSpans: ChunkedSpans[], chunkOffsets: number[]): RedactionSpan[]` for handling documents exceeding 512 tokens.
- **F23.** Tests MUST use realistic UK legal text fixtures containing a mix of names, addresses, NI numbers, case references, organisation names, email addresses, and phone numbers. Tests MUST verify:
  - Rampart label mapping produces correct Ormont categories.
  - UK supplement regex patterns match known formats.
  - Merge correctly deduplicates overlapping spans.
  - Merge preserves non-overlapping spans from both sources.
  - Chunking produces correct offset reassembly.
  - Empty input returns empty arrays.

### API Routes (F24-F29)

- **F24.** `POST /api/documents/:documentId/redaction-runs` MUST:
  - Authenticate and org-scope the request.
  - Validate the document exists and belongs to the requesting organisation.
  - Accept optional body `{ policyMode?: 'internal_ai_minimisation' | 'external_sharing' }` (defaults to `internal_ai_minimisation`).
  - Create a `redaction_runs` record with `status: 'pending'`.
  - Load the document text from `document_versions.text_object_key`.
  - Update status to `'detecting'`.
  - Call the detection module (Rampart in-process + UK supplement + merge).
  - On success: parse returned spans, store in `spans_json`, compute summary, update status to `'ready_for_review'`.
  - On failure: update status to `'failed'`, store failure reason in `summary_json`.
  - Write an audit log entry with action `redaction.run_create`.
  - Return 201 with the run record (excluding full spans array for list brevity; include status, id, policyMode, createdAt).
- **F25.** `GET /api/redaction-runs/:runId` MUST:
  - Authenticate and org-scope.
  - Return the full run record including `spans`, `decisions`, and `summary`.
  - Return 404 with `redaction_run_not_found` if not found or not in org scope.
- **F26.** `GET /api/documents/:documentId/redaction-runs` MUST:
  - Authenticate and org-scope.
  - Return an array of run summaries (id, status, policyMode, createdAt, updatedAt, summary). No spans in list view.
  - Sort by `created_at` descending.
- **F27.** Database helpers (`redaction-database.ts`) MUST follow the pattern in `database.ts`: typed query functions, row mapping, no inline SQL in route handlers. Functions needed:
  - `createRedactionRun(pool, input) -> RedactionRunRecord`
  - `getRedactionRun(pool, organisationId, runId) -> RedactionRunRecord | null`
  - `updateRedactionRunStatus(pool, runId, status, updates?) -> RedactionRunRecord`
  - `listRedactionRunsForDocument(pool, organisationId, documentId) -> RedactionRunRecord[]`
- **F28.** Routes MUST be mounted in `app.ts` using the existing pattern: `app.route('/', createRedactRoutes(pool))`.
- **F29.** The detection module (`redaction-detection.ts`) MUST be a separate module from route handlers, following the pattern of `database.ts`: reusable, testable in isolation, no HTTP concerns.

### Detection Configuration (F30)

- **F30.** The Rampart model id MUST be configurable via an environment variable `REDACT_MODEL_ID` defaulting to `nationaldesignstudio/rampart`. The minimum confidence score MUST be configurable via `REDACT_MIN_SCORE` defaulting to `0.4`. Chunk size MUST be configurable via `REDACT_CHUNK_TOKENS` defaulting to `400`.

### Effect Pilot Containment (F31)

- **F31.** The detection module internals MUST be implemented with Effect per the Effect TS Pilot section: a promise facade at the module boundary, typed failures in the Effect error channel internally, and no `effect` imports anywhere outside the detection module. All other requirements in this PRD (F1–F8 behaviour, F6 error surface, route contracts) are unchanged by the pilot.

## Non-Functional Requirements

- **NFR1. Inference latency:** Rampart MUST return span results within 5 seconds for a 100-page legal document (~200K characters) including chunking overhead. Single-chunk inference is 6.6 ms p50 on CPU.
- **NFR2. Model load time:** First request after API start loads the model (14.7 MB download from HuggingFace if not cached, then ONNX Runtime initialization, 1-5 seconds). Subsequent requests reuse the cached guard. The API SHOULD warm the guard on startup if configured.
- **NFR3. Memory footprint:** The Rampart ONNX model consumes approximately 50-100 MB of RAM at steady state. The 4vCPU/8GB server runs PostgreSQL, the Hono API, and the model concurrently with ample headroom.
- **NFR4. API response time for create-run:** The create-run endpoint is synchronous and includes model inference. For most documents (under 10K characters), response time is under 1 second. For very long documents (200K characters), chunking may add 2-5 seconds. The API timeout and reverse proxy MUST allow for this.
- **NFR5. Data isolation:** Redaction runs are scoped to organisations. All queries filter by `organisation_id`. No cross-org data leakage is possible through the API.
- **NFR6. Audit completeness:** Every state change in a redaction run is recorded in the `audit_logs` table with `entity_type: 'redaction_run'` and the relevant `action`.
- **NFR7. Test coverage:** The `packages/redaction-policy` rampart-map, supplement, merge, and chunk functions MUST have unit tests covering overlapping spans, non-overlapping spans, empty input, all regex patterns, and chunk offset reassembly. Route handlers MUST have integration tests with a test database.
- **NFR8. No external dependencies for detection:** Detection runs entirely in-process. No Docker container, no Python runtime, no external HTTP call. The only external interaction is the first HuggingFace model download (14.7 MB), cached on disk after first load.

## Security And Compliance

- All document text and detected spans are stored within the organisation's database scope. No data from redaction detection is sent to external services.
- Rampart runs in-process in the Hono API. No network exposure beyond the API's existing CORS configuration. No separate service to isolate.
- Model weights are downloaded over HTTPS from HuggingFace (`nationaldesignstudio/rampart`). Weights are cached on disk after first download. No subsequent network calls are needed for detection.
- The `id` prefix convention (`red_`, `span_`) is a lightweight organizational convention, not a security boundary. All authorization is enforced through `organisation_id` scoping in queries.
- Audit logs record every redaction run creation with `userId`, `requestId`, and timestamp. This provides a non-repudiation trail for compliance review.
- No document content is logged to stdout or stored in request logs. The detection module logs inference time and text length only, not text content.
- The `detector_version` field in `redaction_runs` records the Rampart model version and npm package version, enabling future audit of which model version produced which spans.

## Dependencies

- **`@nationaldesignstudio/rampart` (npm):** CC BY 4.0 licensed PII detection package (verified on npm, v0.1.3). Provides `createGuard()` returning a `ChatGuard` with `protect(text)` method. Includes the deterministic recognizer layer and model loading via Transformers.js. The npm description positions it as client-side/browser; Node.js server-side operation MUST be confirmed in the pre-implementation spike (see Rampart Output Mapping) before Phase 1 code is written. CC BY 4.0 requires attribution: a `NOTICE` file (or equivalent attribution in the repo and any user-facing about/licences page) crediting Rampart MUST ship with the product (verified in Phase 3 polish).
- **`@huggingface/transformers` (npm):** Peer dependency of `@nationaldesignstudio/rampart`. Provides ONNX Runtime Web for Node.js (`device: 'cpu'`).
- **`effect` (npm):** Used by the detection module only, per the contained pilot (Effect TS Pilot section). MUST NOT become a dependency of `packages/contracts`, `packages/redaction-policy`, or any other module.
- **Existing database tables:** `matters`, `matter_documents`, `document_versions`, `artifacts` (migration `0002_phase_0_3_matters.sql`) and `audit_logs` (migration `0001_phase_0_2_auth.sql`). The `text_object_key` column on `document_versions` exists but is never populated today: document upload stores metadata only, and no text extraction or storage wiring exists in the codebase (verified July 2026). Phase 1 relies on the `text` request-body fallback and persists it via the storage abstraction (Open Question 7); real extraction arrives in Phase 3.
- **`packages/contracts`:** Shared Zod schemas and TypeScript types. Phase 1 adds redaction-specific schemas to the existing `src/index.ts`.
- **`packages/redaction-policy`:** New package listed in `architecture.md` but not yet created (stub README only). Pure TypeScript, no framework dependencies. This PRD creates it.
- **Infrastructure:** 4vCPU/8GB/160GB Hetzner VPS with Tailscale networking, PostgreSQL 16, Dokploy. No GPU, no Python runtime, no Docker container for detection.
- **[Redact PRD 2: Review and Output](redact-2-review-output.md):** Consumes the spans and run lifecycle built in Phase 1.
- **[Redact PRD 3: Production Readiness](redact-3-production.md):** Adds DOCX extraction, audit report export, and end-to-end demo.

## Rollout

### Definition Of Done

Phase 1 is complete when all of the following are true:

1. The API loads Rampart on first detection request and caches it. `POST /api/documents/:documentId/redaction-runs` with sample legal text returns correctly formatted spans.
2. Migration `0005_redaction.sql` runs successfully against the development and staging databases. Rollback is verified.
3. All Zod schemas and error codes are added to `packages/contracts`. Existing tests pass. No type errors in dependent packages.
4. `packages/redaction-policy` has unit tests passing for rampart-map label conversion, supplement regex patterns (NI number, case reference, organisation name), merge deduplication, and chunk offset reassembly. Tests use realistic legal text fixtures.
5. `POST /api/documents/:documentId/redaction-runs` creates a run, calls Rampart in-process, runs UK supplement, merges spans, stores the result, and returns a 201 with the correct status transition (`pending -> detecting -> ready_for_review`). When the `text` fallback is used, the text is persisted at the `text_object_key` path via the storage abstraction and the column is set on the document version.
6. `GET /api/redaction-runs/:runId` returns the full run with spans and summary.
7. `GET /api/documents/:documentId/redaction-runs` returns a list of runs.
8. Detection failure handling works: when Rampart fails to load or throws, the run transitions to `failed` with a descriptive `failureReason` in the summary.
9. Audit log entries with action `redaction.run_create` are written and visible in the `audit_logs` table.
10. All existing API tests still pass. No regressions.

### Rollback

- Migration `0005_redaction.sql` is reversible: `DROP TABLE IF EXISTS redaction_runs;` removes the table. The corresponding indexes and foreign keys are dropped with the table.
- Rampart is an npm dependency in the API service. Rollback means removing the `@nationaldesignstudio/rampart` and `@huggingface/transformers` dependencies, reverting `app.ts` route mounting, and reverting `packages/contracts` additions.
- `packages/redaction-policy` is a new package with no consumers in Phase 1. Rollback means removing the package directory and reverting `packages/contracts` additions.

## Metrics

| Metric | Target | How Measured |
|---|---|---|
| Rampart inference latency (per chunk) | < 50 ms | Detection module logs: `inference_time_ms` |
| Detection latency (per 10K chars) | < 2 seconds | API request duration excluding DB writes |
| Model cold-start load time | < 5 seconds | Time from first `createGuard()` call to guard ready |
| UK supplement recall | 100% on known-format NI/case-ref test set | Unit tests with fixture data |
| Merge deduplication correctness | 100% overlap test cases pass | Unit tests with overlapping/non-overlapping fixtures |
| Chunk offset reassembly correctness | 100% chunked test cases pass | Unit tests with multi-chunk documents |
| Create-run success rate | > 95% of requests | API response status codes |
| Run status correctness | 100% of runs follow status state machine | Integration tests for each transition path |
| Existing test pass rate | 100% | CI pipeline |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rampart model produces high false-positive rate on legal text (e.g. flags "Smith" as person when it is part of a case citation) | Medium | Low-Medium | Token-level context window and bidirectional understanding are designed to reduce this. False positives are visible as spans that reviewers can reject. Fine-tuning (post-MVP) will improve accuracy for legal text. |
| First request after API restart is slow (model download + initialization) | High | Low | 14.7 MB downloads in 1-2 seconds. Warm the guard on API startup. Document the behaviour. |
| Chunking edge cases (spans split across chunk boundaries) | Medium | Medium | Overlap chunks by 50 tokens on each side. Deduplicate spans in overlap region. Test with documents at chunk boundaries. |
| Rampart 512-token limit truncates long paragraphs | Low | Medium | Chunking handles this. Document the chunking strategy. Test with very long legal documents. |
| UK supplement regex patterns match false positives (e.g. a random 9-digit number that is not a passport) | Medium | Low | Regex patterns are deliberately conservative. NI pattern requires the two-letter prefix. Case reference patterns match known firm formats. Matches appear as `low` confidence suggestions. Reviewers can reject. |
| Migration conflicts with future migrations | Low | Low | The migration uses `create table if not exists`. The filename `0005_redaction.sql` follows the existing numbering convention. |
| Effect pilot underdelivers (idiom violations, review drag) | Medium | Low | Contained behind the promise facade by construction; unwind is a one-module rewrite in plain TS with no API, contract, or schedule contagion. Exit criteria and decision gate defined in the Effect TS Pilot section. |

## Open Questions

1. **Should the UK supplement include `organisation_name` as a category, or should it remain solely a model-detected concept?** Organisation names in legal text are tricky: "Smith & Jones LLP" should be kept (it is a law firm), but "Mr Smith" should be redacted. The supplement can add organisation detection via known suffixes (LLP, Ltd, plc, Solicitors, Chambers). Deferred until Phase 2 or 3.

2. **Should the detection module warm the Rampart guard on API startup or lazily on first request?** Warming on startup adds 1-5 seconds to startup time but eliminates the first-request delay. Lazy loading keeps startup fast but adds latency to the first redaction run. Decision: warm on startup in production, lazy in development.

3. **Should `person_name` eventually split into role-aware subcategories?** Legal redaction is role-dependent: judges, counsel, and solicitors are on the public record (normally kept); claimants, witnesses, and clients are normally redacted; children and anonymity-order subjects MUST be redacted. v1 collapses all of these into `person_name`, so the reviewer carries the distinction manually and the two policy modes barely differ for person spans. The planned evolution is `ormont_legal_v2` (see the Label space roadmap in [Redact PRD 3](redact-3-production.md)): `person_party` / `person_professional` / `person_protected`, at which point policy modes gain real differentiation (e.g. `external_sharing` keeps professionals). Phase 1 only needs to preserve the door: the category schema is versioned via contracts, and the Rampart mapping layer is the single place a category set change lands. No v1 action required.

4. **Should the `organisation_name` category be surfaced as a span at all, or should it be silently kept?** Some firms may want to redact organisation names for external sharing. The category exists in the schema with suggestion `keep` by default. This can be configuration-driven in a post-MVP policy engine.

5. **What is the maximum text length for Phase 1 synchronous processing?** Rampart's 512-token limit means all documents are chunked. The API should handle documents up to 200K characters without timeout. Chunking adds 2-5 seconds for very long documents. Truncation is not needed; chunking handles arbitrary length.

6. **Should `detector_version` capture the Rampart npm package version, the model checkpoint hash, or both?** Phase 1 stores the `@nationaldesignstudio/rampart` package version string (e.g. `0.1.3`) and the HuggingFace model id. If fine-tuning is introduced post-MVP, the version field may need to expand to include checkpoint hash and fine-tuning dataset identifier.

7. **How should the `text_object_key` path be populated for Phase 1?** The column exists but text extraction (reading the uploaded file and writing extracted text to object storage) is not yet implemented. Phase 1 may require manual seeding of the text object key for test documents, or a simplified in-memory text pass during document upload. This is noted as a dependency for the demo flow and may be temporarily worked around by allowing direct text submission. Decision: Phase 1 route accepts a `text` fallback in the request body for testing. Production text extraction arrives in Phase 3, and the `text` fallback MUST be removed at that point (tracked as a requirement in [Redact PRD 3](redact-3-production.md)) — it allows redaction runs against text that differs from the stored document version. When the fallback is used, the submitted text MUST be persisted through a minimal `StorageService` abstraction (first adapter: local filesystem) at the `text_object_key` path, and the column set on the document version. This is required for Phase 2: finalize re-reads the text to apply decisions and to run its fail-closed span-integrity check, so the exact text the spans were computed against must be reloadable. Phase 1 therefore introduces the `StorageService` interface; Phase 2 reuses it for output artifacts; Phase 3 adds the object-storage adapter and real extraction.
