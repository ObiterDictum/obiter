# Redact Month 1: Foundation And Detection Pipeline PRD

## Summary

Redact is Ormont's confidentiality and privacy layer. It detects personally identifiable information (PII) and secrets in matter documents, applies legal-specific redaction policy, supports pseudonymisation, and produces audited outputs with human review checkpoints.

Month 1 builds the detection pipeline end-to-end: a Python worker running OpenAI Privacy Filter (1.5B param, CPU-optimised, Apache 2.0), the database schema for redaction runs, a TypeScript regex supplement for UK legal-specific patterns, a span merging engine, and the API skeleton for run creation and lifecycle. After Month 1, a user can upload a document, trigger a redaction run, and see detected spans ready for review.

Follow-on work is defined in sibling PRDs:
- [Redact Month 2: Review And Output](redact-month2.md): span review UI, decision submission, pseudonymisation, output generation, finalization.
- [Redact Month 3: Polish And Demo](redact-month3.md): DOCX extraction, audit report export, demo fixture, end-to-end testing, edge case handling.

See the detailed implementation at [docs/specs/redact/build-plan.md](../specs/redact/build-plan.md).

Shared contracts live in `packages/contracts`. Redaction policy logic lives in `packages/redaction-policy`.

## Problem

Before legal AI can process a matter document, the document must be safe. Client data — names, addresses, phone numbers, email addresses, dates of birth, national insurance numbers, passport numbers, bank account details, internal case references — must be detected and either removed or pseudonymised before the document enters any AI pipeline, is shared with external counsel, or generates an output artifact.

Current approaches are inadequate:

- **Regex-only detection** misses context-dependent PII (e.g. distinguishing "Mr Smith is the claimant" from "Smith v Jones is a citation"). It produces high false-positive rates that destroy review trust.
- **Closed-source redaction APIs** send client data to third-party servers, which many law firms and compliance departments prohibit.
- **Rule-based systems** require expensive manual configuration per firm and per document type.
- **Manual redaction** does not scale. A 200-page disclosure bundle reviewed by associates at £300/hour is neither fast nor consistent.

OpenAI Privacy Filter solves the detection problem: it is open-weight (Apache 2.0), runs fully locally (no data leaves the server), understands context (it is a bidirectional token classifier, not a regex engine), and achieves 97.43% F1 on the PII-Masking-300k benchmark. But it has gaps for UK legal text — national insurance numbers, passport numbers, case references — and its 8 built-in categories must be mapped to Ormont's 12-category span model.

Month 1 exists to close the gap between "a model that detects PII" and "a production redaction service that firms can verify."

## Product Principles

- **Detection must be context-aware, not pattern-only.** The system must distinguish a person name in a narrative from a party name in a case citation.
- **All detection runs locally.** No document content ever leaves the server's memory or storage for detection.
- **Model output is a first pass, not a final answer.** Every detected span is a suggestion. Human review is required before any output is trusted.
- **UK legal-specific patterns supplement the model.** National Insurance numbers, passport numbers, and case references are known fixed-format patterns that the model may not cover; the regex supplement catches them explicitly.
- **Model wins on overlap.** When both the Privacy Filter and the regex supplement detect the same span, the model's confidence and category assignment take precedence.
- **Spans are suggestions with confidence scores, not immutable judgments.** Every span carries a category, confidence level, and suggested action. Reviewers can accept, reject, override, or pseudonymise each one.
- **The run lifecycle is explicit and auditable.** Every status transition and decision is recorded in the audit log.
- **Spans are stored as a JSONB array within the run.** A separate spans table is unnecessary for Month 1; the run record contains everything needed for review.
- **The Python worker does one thing and does it well.** It runs model inference. No business logic, no database access, no external network calls.

## Goals

- Run OpenAI Privacy Filter as a long-running Python FastAPI service, processing text on CPU (no GPU required).
- Accept text via `POST http://localhost:8788/detect` and return spans in Ormont's internal format.
- Store redaction runs in PostgreSQL with full foreign-key relationships to matters, documents, and document versions.
- Define 12 span categories (8 from the Privacy Filter, 4 from the regex supplement) and map between model labels and Ormont categories.
- Implement TypeScript regex patterns for UK National Insurance numbers, passport numbers, and case references.
- Merge Privacy Filter spans with regex supplement spans, deduplicating overlaps with Privacy Filter winning on confidence.
- Provide `POST /api/documents/:documentId/redaction-runs` to create a run, trigger detection, and store results.
- Provide `GET /api/redaction-runs/:runId` to retrieve a run with spans, decisions, and summary.
- Provide `GET /api/documents/:documentId/redaction-runs` to list runs for a document.
- Handle worker unavailability gracefully: set run status to `failed` with a descriptive reason.
- Add redaction contracts (span category, source, status, policy mode schemas) and error codes to `packages/contracts`.

## Non-Goals

- No span review UI in Month 1. Review is Month 2.
- No span decision submission in Month 1. Decisions are Month 2.
- No pseudonymisation or output generation in Month 1. Output generation is Month 2.
- No DOCX or PDF text extraction in Month 1. Month 1 works with plain text only. DOCX extraction is Month 3.
- No desktop-local redaction path. Desktop-only mode is post-MVP.
- No PDF-safe redaction in Month 1. PDF handling is a separate workstream.
- No fine-tuning of the Privacy Filter model in Month 1. Fine-tuning is post-MVP when sufficient legal-domain training data exists.
- No batch processing or queue-based architecture. Month 1 is synchronous request-response for simplicity.
- No vector search or semantic retrieval for span detection. The Privacy Filter is a bidirectional token classifier, not a retrieval system.

## Users

### Legal Professional (Reviewer)

A solicitor, paralegal, or compliance officer who needs to review detected PII spans in a matter document, accept or reject each span, and produce a clean output for sharing or AI processing. In Month 1, this user can create a redaction run and see detected spans. Review actions arrive in Month 2.

### Firm Administrator

Responsible for policy configuration: which categories are redacted, pseudonymised, or kept for internal AI minimisation versus external sharing. Policy modes are stored in Month 1; policy customisation is post-MVP.

### Builder Or Integrator

A developer integrating Ormont Redact into a firm's document workflow. Needs stable API contracts, predictable error codes, and the ability to automate redaction run creation. Month 1 provides the create-run and get-run endpoints.

## Core Use Cases

1. Legal professional uploads a document, triggers a redaction run, and sees all detected PII spans organised by category, source, and confidence.
2. System detects person names, email addresses, phone numbers, physical addresses, dates, account numbers, secrets, and URLs via the Privacy Filter model.
3. System detects UK National Insurance numbers, passport numbers, and internal case references via regex supplement.
4. Overlapping spans from model and regex are merged; model-assigned categories and confidence take precedence.
5. System records the detector version and detector run metadata for auditability.
6. System handles worker failure gracefully, recording the failure reason and leaving the run in a `failed` state for retry.
7. Legal professional can see a summary of detected spans grouped by category and source before beginning review.

## Scope

Month 1 delivers the detection pipeline and API skeleton. Everything needed to go from "document has text" to "spans detected and stored, ready for human review."

### In Scope

- Python FastAPI worker (`services/redact-worker/`) serving `POST /detect` internally on `localhost:8788`.
- Privacy Filter model auto-download, CPU-only inference, BIOES-to-span mapping.
- Database migration `0005_redaction.sql` creating the `redaction_runs` table.
- Redaction contracts in `packages/contracts`: span categories, sources, statuses, policy modes, error codes.
- Redaction policy package (`packages/redaction-policy/`) with types, regex supplement, and span merging.
- API routes: create run, get run, list runs for document.
- Worker client in the API service (`redaction-worker-client.ts`).
- Database helpers for run CRUD (`redaction-database.ts`).
- Audit log entries for redaction run creation.
- Worker failure handling and run status transitions (`pending -> detecting -> ready_for_review | failed`).
- The run summary computation (span counts by category and source).

### Out Of Scope (Month 1)

- Span review UI and decision submission (Month 2).
- Output generation (redacted or pseudonymised text) (Month 2).
- DOCX or PDF extraction (Month 3).
- PDF-safe redaction (separate workstream).
- Fine-tuning the Privacy Filter model.
- Batch processing queue.
- Desktop-local detection path.
- Policy customisation per organisation.
- Automated sign-off or no-review finalization.

## Detection Architecture

### Two-Layer Detection Strategy

Redact uses two detection layers in sequence:

1. **OpenAI Privacy Filter (Python worker):** A bidirectional token classifier with Viterbi decoder. Context-aware: it understands that "Smith" in "Smith v Jones" is a citation, not a person to redact. Runs on CPU. Returns spans with category labels from its 8 built-in categories.

2. **TypeScript regex supplement (`packages/redaction-policy/supplement.ts`):** Fixed-pattern regex matches for UK legal-specific identifiers that the model does not reliably cover. Runs in the API service after the worker returns.

### Privacy Filter Output Mapping

The Privacy Filter outputs BIOES (Begin, Inside, Outside, End, Singleton) token tags. These are decoded into contiguous character spans and mapped to Ormont's category set:

| Privacy Filter Label | Ormont Category | Notes |
|---|---|---|
| `private_person` | `person_name` | Names of private individuals |
| `private_address` | `address` | Physical addresses |
| `private_email` | `email` | Email addresses |
| `private_phone` | `phone` | Phone numbers |
| `private_url` | `url` | URLs containing PII |
| `private_date` | `date` | Dates tied to private individuals |
| `account_number` | `account_number` | Credit cards, bank accounts |
| `secret` | `secret` | Passwords, API keys, tokens |

### Regex Supplement Patterns

The regex supplement catches patterns the model may miss:

| Ormont Category | Pattern | Example |
|---|---|---|
| `national_insurance` | `[A-Z]{2}\d{6}[A-Z]` | QQ123456C |
| `passport` | `\d{9}` (9-digit UK passport numbers) | 123456789 |
| `case_reference` | Flexible pattern for firm-specific reference formats | `2024/ABC/123`, `CR-2024-00123` |
| `organisation_name` | Optional; captured by regex if needed, or by Privacy Filter as `private_person` context | Currently supplement-only, may be merged with model output |

### Span Merging Rules

The merge function in `packages/redaction-policy/merge.ts` applies these rules:

1. Both span sets are sorted by character start position.
2. If two spans overlap (one starts before the other ends), the Privacy Filter span's category and confidence are kept; the regex supplement span is discarded.
3. If a regex supplement span exactly matches a Privacy Filter span in position, the Privacy Filter span wins.
4. Spans with zero length (`start === end`) are discarded.
5. The output is a deduplicated, sorted array of `RedactionSpan` objects.

### Worker Lifecycle

The Python worker is a long-running process. Model weights (~1.5 GB) are downloaded on first launch and cached at `~/.opf/privacy_filter`. Loading the model into memory consumes approximately 3 GB of RAM and takes 10-30 seconds. The worker is not spawned per request; it runs as a Docker container managed by Dokploy, started once and kept alive.

Health check: The worker exposes `GET /health` returning `{"status": "ok"}`. The API service checks this endpoint before sending detection requests.

### Run Status Flow

```
pending -> detecting -> ready_for_review (success)
pending -> detecting -> failed (worker unavailable or error)
```

Status transitions:
- `pending`: Run record created in database. No detection started.
- `detecting`: API has sent text to the Python worker and is awaiting response. Set before the HTTP call, not after.
- `ready_for_review`: Worker returned spans. Regex supplement ran. Merging complete. Spans stored in `spans_json`. Run ready for human review.
- `failed`: Worker returned an error, timed out, or was unreachable. `summary_json.failure_reason` contains a human-readable description. Users can retry by creating a new run.

## Functional Requirements

### Python Redact Worker (F1–F8)

- **F1.** The worker MUST serve `POST /detect` accepting `Content-Type: application/json` with body `{ "text": string }` and returning `{ "spans": [{ start, end, text, category, confidence }] }`.
- **F2.** The worker MUST serve `GET /health` returning `{ "status": "ok" }`.
- **F3.** The worker MUST download the Privacy Filter model weights on first start if not already cached at `~/.opf/privacy_filter`.
- **F4.** The worker MUST run inference on CPU only. No GPU dependency.
- **F5.** The worker MUST map Privacy Filter BIOES token tags to Ormont span format: character offsets (start, end), matched text, category string from model, and confidence (`high`, `medium`, or `low`).
- **F6.** The worker MUST handle empty text input: return `{ "spans": [] }` without error.
- **F7.** The worker MUST handle input exceeding the model's 128K token context window by returning a 413 status with a descriptive error message. Client-side truncation is handled by the API service.
- **F8.** The worker MUST log model loading time, inference time, and text length for each request to stdout for monitoring.

### Database Schema (F9–F14)

- **F9.** The migration `0005_redaction.sql` MUST create the `redaction_runs` table with columns: `id` (text, `red_` prefix), `organisation_id`, `matter_id`, `document_id`, `document_version_id`, `status` (enum via check constraint), `policy_mode` (enum via check constraint), `spans_json` (JSONB, default `[]`), `decisions_json` (JSONB, default `{}`), `output_artifact_id` (text, nullable, references `artifacts(id)`), `summary_json` (JSONB, default `{}`), `detector_version` (text, nullable), `created_by` (references `users(id)`), `created_at`, `updated_at`.
- **F10.** The status check constraint MUST permit exactly: `'pending'`, `'detecting'`, `'ready_for_review'`, `'reviewing'`, `'finalized'`, `'failed'`.
- **F11.** The policy mode check constraint MUST permit exactly: `'internal_ai_minimisation'`, `'external_sharing'`.
- **F12.** Foreign key constraints MUST reference: `matters(id, organisation_id)`, `matter_documents(id, matter_id, organisation_id)`, `document_versions(id, matter_document_id, matter_id, organisation_id)`.
- **F13.** Indexes MUST exist on: `(matter_id)`, `(document_id)`, `(status)`, `(organisation_id, matter_id)`.
- **F14.** The `summary_json` field MUST store computed summary data: `totalSpans`, `byCategory` (record of category->count), `bySource` (`{ privacyFilter: number, regexSupplement: number }`), `reviewedCount` (0 initially), `unreviewedCount` (equals totalSpans initially), and optionally `failureReason` (string) for failed runs.

### Contracts (F15–F17)

- **F15.** The following Zod schemas MUST be added to `packages/contracts/src/index.ts`:
  - `spanCategorySchema`: enum of 12 values (`person_name`, `email`, `phone`, `address`, `date`, `account_number`, `secret`, `url`, `national_insurance`, `passport`, `case_reference`, `organisation_name`).
  - `spanSourceSchema`: enum (`privacy_filter`, `regex_supplement`).
  - `redactionRunStatusSchema`: enum (`pending`, `detecting`, `ready_for_review`, `reviewing`, `finalized`, `failed`).
  - `redactionPolicyModeSchema`: enum (`internal_ai_minimisation`, `external_sharing`).
  - `spanConfidenceSchema`: enum (`high`, `medium`, `low`).
  - `spanSuggestionSchema`: enum (`redact`, `pseudonymise`, `keep`).
  - `spanDecisionSchema`: enum (`accept`, `reject`, `override_redact`, `override_keep`, `pseudonymise`).
  - `outputModeSchema`: enum (`redacted`, `pseudonymised`).
- **F16.** The following error codes MUST be added to `apiErrorCodeSchema`:
  - `redaction_run_not_found`: Run ID does not exist or is not accessible in the organisation scope.
  - `span_not_found`: Span ID does not exist within the specified run.
  - `redaction_run_not_reviewable`: Run is not in a state that allows review operations (not `ready_for_review` or `reviewing`).
  - `redaction_already_finalized`: Run has already been finalized and cannot be modified.
  - `redaction_worker_unavailable`: The Python redact worker is not reachable or returned an error.
- **F17.** TypeScript types MUST be exported for each schema (e.g. `SpanCategory`, `RedactionRunStatus`, etc.) using `z.infer`.

### Redaction Policy Package (F18–F22)

- **F18.** `packages/redaction-policy/src/types.ts` MUST export:
  - `RedactionSpan`: `{ id: string, start: number, end: number, text: string, category: SpanCategory, source: SpanSource, confidence: SpanConfidence, suggestion: SpanSuggestion }`.
  - `SpanCategory`, `SpanSource`, `SpanConfidence`, `SpanSuggestion`, `SpanDecision` (all `z.infer<>` from contracts or standalone enums).
  - `Decisions`: `Record<string, { decision: SpanDecision, decidedBy: string, decidedAt: string }>`.
  - `RunSummary`: `{ totalSpans: number, byCategory: Record<SpanCategory, number>, bySource: { privacyFilter: number, regexSupplement: number }, reviewedCount: number, unreviewedCount: number }`.
- **F19.** `supplement.ts` MUST export `supplementSpans(text: string): RedactionSpan[]` that applies regex patterns for UK National Insurance numbers, passport numbers, and case references.
- **F20.** `merge.ts` MUST export `mergeSpans(privacyFilterSpans: RedactionSpan[], regexSpans: RedactionSpan[]): RedactionSpan[]` that:
  - Sorts both arrays by `start` position.
  - For overlapping spans, keeps the Privacy Filter span and discards the regex span.
  - For non-overlapping spans, preserves both.
  - Assigns suggestions based on category: `person_name`, `email`, `phone`, `address`, `account_number`, `secret`, `national_insurance`, `passport` default to `redact`; `date`, `url`, `case_reference`, `organisation_name` default to `keep` (reviewer decides).
- **F21.** `index.ts` MUST export all public functions and types from the package.
- **F22.** Tests (`index.test.ts` or supplement + merge tests) MUST use realistic UK legal text fixtures containing a mix of names, addresses, NI numbers, passport numbers, case references, email addresses, and phone numbers. Tests MUST verify:
  - Regex patterns match known formats.
  - Merge correctly deduplicates overlapping spans.
  - Merge preserves non-overlapping spans from both sources.
  - Empty input returns empty arrays.

### API Routes (F23–F28)

- **F23.** `POST /api/documents/:documentId/redaction-runs` MUST:
  - Authenticate and org-scope the request.
  - Validate the document exists and belongs to the requesting organisation.
  - Accept optional body `{ policyMode?: 'internal_ai_minimisation' | 'external_sharing' }` (defaults to `internal_ai_minimisation`).
  - Create a `redaction_runs` record with `status: 'pending'`.
  - Load the document text from `document_versions.text_object_key`.
  - Update status to `'detecting'`.
  - Call the Python worker via the worker client. Pass text in the request body.
  - On worker success: parse returned spans, run regex supplement, merge, store in `spans_json`, compute summary, update status to `'ready_for_review'`.
  - On worker failure or timeout: update status to `'failed'`, store failure reason in `summary_json`.
  - Write an audit log entry with action `redaction.run_create`.
  - Return 201 with the run record (excluding full spans array for list brevity; include status, id, policyMode, createdAt).
- **F24.** `GET /api/redaction-runs/:runId` MUST:
  - Authenticate and org-scope.
  - Return the full run record including `spans`, `decisions`, and `summary`.
  - Return 404 with `redaction_run_not_found` if not found or not in org scope.
- **F25.** `GET /api/documents/:documentId/redaction-runs` MUST:
  - Authenticate and org-scope.
  - Return an array of run summaries (id, status, policyMode, createdAt, updatedAt, summary). No spans in list view.
  - Sort by `created_at` descending.
- **F26.** Worker client (`redaction-worker-client.ts`) MUST:
  - Accept text string and return parsed span array.
  - Use `fetch` to call `http://localhost:8788/detect`.
  - Set a 60-second timeout (model inference on CPU for long documents may take 10–30 seconds).
  - On network error, timeout, or non-200 response: throw a typed error that the route handler catches and maps to `redaction_worker_unavailable`.
- **F27.** Database helpers (`redaction-database.ts`) MUST follow the pattern in `database.ts`: typed query functions, row mapping, no inline SQL in route handlers. Functions needed:
  - `createRedactionRun(pool, input) -> RedactionRunRecord`
  - `getRedactionRun(pool, organisationId, runId) -> RedactionRunRecord | null`
  - `updateRedactionRunStatus(pool, runId, status, updates?) -> RedactionRunRecord`
  - `listRedactionRunsForDocument(pool, organisationId, documentId) -> RedactionRunRecord[]`
- **F28.** Routes MUST be mounted in `app.ts` using the existing pattern: `app.route('/', createRedactRoutes(pool))`.

### Worker Client Configuration (F29)

- **F29.** The worker URL MUST be configurable via an environment variable `REDACT_WORKER_URL` defaulting to `http://localhost:8788`. Timeout MUST be configurable via `REDACT_WORKER_TIMEOUT_MS` defaulting to `60000`.

## Non-Functional Requirements

- **NFR1. Inference latency:** The Python worker MUST return span results within 60 seconds for a 100-page legal document (~200K characters). If the document exceeds 128K tokens, the API service truncates or rejects before sending.
- **NFR2. Worker startup time:** Model loading (10–30 seconds) happens once at container start. The health endpoint MUST NOT return OK until the model is loaded and inference-ready.
- **NFR3. Worker memory:** The worker process MUST stay under 4 GB RSS at steady state. The 4vCPU/8GB Hetzner server runs PostgreSQL, the Hono API, and this worker concurrently.
- **NFR4. API response time for create-run:** The create-run endpoint is synchronous and includes model inference. If the worker is slow, the API request may take 30–60 seconds. The API timeout and reverse proxy (nginx/Caddy) MUST allow for this. Month 2 introduces async queue-based processing if synchronous proves problematic.
- **NFR5. Data isolation:** Redaction runs are scoped to organisations. All queries filter by `organisation_id`. No cross-org data leakage is possible through the API.
- **NFR6. Audit completeness:** Every state change in a redaction run is recorded in the `audit_logs` table with `entity_type: 'redaction_run'` and the relevant `action`.
- **NFR7. Test coverage:** The `packages/redaction-policy` supplement and merge functions MUST have unit tests covering overlapping spans, non-overlapping spans, empty input, and all regex patterns. The worker client MUST have unit tests with mocked fetch responses. Route handlers MUST have integration tests with a test database.
- **NFR8. Docker isolation:** The Python worker runs in a separate Docker container. It does not share network namespaces with the API (beyond localhost). It does not have access to PostgreSQL, object storage, or the outside internet beyond downloading model weights on first start.

## Security And Compliance

- All document text and detected spans are stored within the organisation's database scope. No data from redaction detection is sent to external services.
- The Python worker listens on `localhost:8788` only. It is not exposed to the internet. Dokploy's internal networking or Docker compose network isolation prevents external access.
- Model weights are downloaded over HTTPS from HuggingFace (`openai/privacy-filter`). The checkpoint integrity is verified by the `opf` library on load.
- The `id` prefix convention (`red_`, `span_`) is a lightweight organizational convention, not a security boundary. All authorization is enforced through `organisation_id` scoping in queries.
- Audit logs record every redaction run creation with `userId`, `requestId`, and timestamp. This provides a non-repudiation trail for compliance review.
- No document content is logged to stdout or stored in request logs. The audit log records metadata only.
- The `detector_version` field in `redaction_runs` records the Privacy Filter checkpoint version, enabling future audit of which model version produced which spans.

## Dependencies

- **OpenAI Privacy Filter (`openai/privacy-filter`):** Apache 2.0 licensed open-weight model. Requires `opf` Python package, PyTorch (CPU-only), and ~1.5 GB of model weights. GitHub: `openai/privacy-filter`.
- **Python 3.11+ runtime:** Required for the redact worker. Deployed as a Docker container (Python 3.11-slim base image).
- **PyTorch (CPU):** Required by the Privacy Filter model. CPU-only install (`pip install torch --index-url https://download.pytorch.org/whl/cpu`). Approximately 800 MB.
- **FastAPI + Uvicorn:** Python web framework for the worker's internal HTTP API.
- **Existing database tables:** `matters`, `matter_documents`, `document_versions`, `artifacts`, `audit_logs` (all from migration `0002_phase_0_3_matters.sql`). The `text_object_key` column on `document_versions` already exists and is populated when text extraction runs.
- **`packages/contracts`:** Shared Zod schemas and TypeScript types. Month 1 adds redaction-specific schemas to the existing `src/index.ts`.
- **`packages/redaction-policy`:** New package listed in `architecture.md` but not yet created. Pure TypeScript, no framework dependencies. This PRD creates it.
- **Infrastructure:** Docker and Dokploy for the worker container. PostgreSQL 16 at `localhost:5432`. 4vCPU/8GB Hetzner VPS with Tailscale networking. No GPU.
- **[Redact Month 2: Review And Output](redact-month2.md):** Consumes the spans and run lifecycle built in Month 1.
- **[Redact Month 3: Polish And Demo](redact-month3.md):** Adds DOCX extraction, audit report export, and end-to-end demo.

## Rollout

### Definition Of Done

Month 1 is complete when all of the following are true:

1. The Python worker Docker image builds and runs. `GET /health` returns OK. `POST /detect` with sample legal text returns correctly formatted spans.
2. Migration `0005_redaction.sql` runs successfully against the development and staging databases. Rollback is verified.
3. All 8 Zod schemas and 5 error codes are added to `packages/contracts`. Existing tests pass. No type errors in dependent packages.
4. `packages/redaction-policy` has unit tests passing for supplement regex patterns (NI number, passport, case reference) and merge deduplication. Tests use realistic legal text fixtures.
5. `POST /api/documents/:documentId/redaction-runs` creates a run, calls the worker, merges spans, stores the result, and returns a 201 with the correct status transition (`pending -> detecting -> ready_for_review`).
6. `GET /api/redaction-runs/:runId` returns the full run with spans and summary.
7. `GET /api/documents/:documentId/redaction-runs` returns a list of runs.
8. Worker failure handling works: when the worker is unreachable, the run transitions to `failed` with a descriptive `failureReason` in the summary.
9. Audit log entries with action `redaction.run_create` are written and visible in the `audit_logs` table.
10. All existing API tests still pass. No regressions.

### Rollout Sequence

1. **Week 1‑2: Core infrastructure.**
   - Set up `services/redact-worker/` with `pyproject.toml`, `Dockerfile`, `server.py`, `detector.py`, `spans.py`.
   - Verify worker runs locally with sample text.
   - Write migration `0005_redaction.sql`.
   - Add contracts to `packages/contracts`.
   - Scaffold `packages/redaction-policy/` with `types.ts`, `supplement.ts`, `merge.ts`, and tests.
   - Scaffold `redaction-database.ts`, `redaction-worker-client.ts`, and route skeleton.

2. **Week 3‑4: Integration and testing.**
   - Wire up `POST /api/documents/:documentId/redaction-runs` end-to-end.
   - Implement `GET` routes.
   - Write integration tests for the full create-run flow (success + failure).
   - Deploy worker Docker container to staging.
   - Verify against a realistic legal text fixture.
   - Run all existing API tests to confirm no regressions.

### Rollback

- Migration `0005_redaction.sql` is reversible: `DROP TABLE IF EXISTS redaction_runs;` removes the table. The corresponding indexes and foreign keys are dropped with the table.
- The Python worker is a new Docker service. It has no production traffic in Month 1. Rollback means stopping the container and removing its `app.route()` line in `app.ts`.
- `packages/redaction-policy` is a new package with no consumers in Month 1. Rollback means removing the package directory and reverting `packages/contracts` additions.

## Metrics

| Metric | Target | How Measured |
|---|---|---|
| Worker inference latency (per 1000 chars) | < 5 seconds | Worker logs: `inference_time_ms / text_length` |
| Worker memory usage (steady state) | < 4 GB RSS | `docker stats` on worker container |
| Worker uptime | > 99% | Health check polling every 30 seconds |
| Regex supplement recall | 100% on known-format NI/passport/case-ref test set | Unit tests with fixture data |
| Merge deduplication correctness | 100% overlap test cases pass | Unit tests with overlapping/non-overlapping fixtures |
| Create-run success rate | > 95% of requests | API response status codes |
| Create-run 95th percentile latency | < 45 seconds | API request duration histogram |
| Run status correctness | 100% of runs follow status state machine | Integration tests for each transition path |
| Existing test pass rate | 100% | CI pipeline |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Privacy Filter model produces high false-positive rate on legal text (e.g. flags "Smith" as person when it is part of a case citation) | Medium | Low–Medium | Token-level context window and bidirectional understanding are designed to reduce this. Regex supplement is Gated Field-only (does not attempt person detection). False positives are visible as spans that reviewers can reject. Fine-tuning (post-MVP) will improve accuracy for legal text. |
| Worker CPU inference is too slow for long documents (>128K tokens) | Medium | Medium | The model's 128K context is the hard limit. For documents approaching this limit, the API truncates before sending. Month 1 targets synchronous request-response; if latency is unacceptable, Month 2 switches to async queue-based processing with BullMQ. |
| Model weights download fails or checkpoint is corrupted on first deploy | Low | High | Dockerfile includes a health check that verifies model loading. If the checkpoint is missing or corrupt, the container restarts and retries. Dokploy restart policy handles this. |
| Worker runs out of memory alongside PostgreSQL and the Hono API on 8 GB server | Medium | Medium | Monitor with `docker stats`. If memory pressure is high, move worker to a separate 4 GB VPS (Tailscale-connected). The server has 160 GB disk for swap as emergency fallback. |
| Regex patterns match false positives in document text (e.g. a 9-digit number that is not a passport) | Medium | Low | Regex patterns are deliberately conservative. The NI pattern requires the two-letter prefix (which has check constraints by HMRC). The passport pattern is 9-digit with optional leading `P` prefix. Matches appear as `low` confidence suggestions. Reviewers can reject false positives. |
| Migration conflicts with future migrations | Low | Low | The migration uses `create table if not exists`. The filename `0005_redaction.sql` follows the existing numbering convention. |

## Open Questions

1. **Should the regex supplement include `organisation_name` as a category, or should it remain solely a model-detected concept?** Organisation names in legal text are tricky: "Smith & Jones LLP" should be kept (it is a law firm), but "Mr Smith" should be redacted. The Privacy Filter model already handles this distinction with its context window. The regex supplement can optionally add organisation detection via known suffixes (LLP, Ltd, plc, Solicitors, Chambers), but this is deferred until Month 3.

2. **Should the worker client retry on transient failures?** Month 1 fails fast and sets status to `failed`. For documents under 10K characters where inference takes < 1 second, one retry with a 5-second timeout might improve reliability. Decision deferred until Month 2 metrics.

3. **Should the `organisation_name` category be surfaced as a span at all, or should it be silently kept?** Some firms may want to redact organisation names for external sharing. The category exists in the schema with suggestion `keep` by default. This can be configuration-driven in a post-MVP policy engine.

4. **What is the maximum text length for Month 1 synchronous processing?** The 128K token limit of the Privacy Filter model translates to roughly 180K–200K characters of English text. The API should reject or truncate text exceeding this before sending to the worker. The exact truncation strategy (head-only, tail-only, or middle-drop) depends on document type and is deferred to Month 2 usage analysis.

5. **Should `detector_version` capture the Privacy Filter release version, git commit of the weights, or both?** Month 1 stores the `opf` package version string (e.g. `opf==0.1.0`) as the detector version. If fine-tuning is introduced post-MVP, the version field may need to expand to include checkpoint hash and fine-tuning dataset identifier.

6. **How should the `text_object_key` path be populated for Month 1?** The column exists but text extraction (reading the uploaded file and writing extracted text to object storage) is not yet implemented. Month 1 may require manual seeding of the text object key for test documents, or a simplified in-memory text pass during document upload. This is noted as a dependency for the demo flow and may be temporarily worked around by allowing direct text submission. Decision: Month 1 route accepts a `text` fallback in the request body for testing. Production text extraction arrives in Month 3.
