# Redact PRD 3: Production Readiness, Audit, and Synthetic Data

## Summary

This phase completes the Ormont Redact module. It turns the Phase 1-2 detection and review pipeline into a production-ready capability by adding real document format support (DOCX text extraction via `mammoth`), formal audit report export, synthetic training data generation for Rampart fine-tuning, a dataset export tool for the human-in-the-loop improvement loop, a prepared demo for firm evaluations, and full end-to-end testing.

Redact Phase 1 established the detection pipeline powered by Rampart (14.7 MB ONNX token-classification model via Transformers.js) and a UK supplement for legal-specific PII patterns. Phase 2 added the review UI, span decision persistence, and redacted/pseudonymised output generation. This phase makes the product demonstrable to firms, producible for audit, and extensible through fine-tuning.

See the detailed implementation at [docs/specs/redact/build-plan.md](../specs/redact/build-plan.md). Cross-reference siblings: [Redact PRD 1: Detection Pipeline](redact-1-detection.md), [Redact PRD 2: Review and Output](redact-2-review-output.md).

## Problem

Phases 1 and 2 deliver a working redaction pipeline, but three gaps prevent it from being a credible product:

1. **Only plain text passes through the pipeline** (via Phase 1's request-body `text` fallback — real file extraction does not exist yet). Legal documents are almost exclusively DOCX. Without DOCX extraction, no real document can pass through the pipeline. Firms cannot test the product on their own files.

2. **No audit trail is exportable.** The audit log records actions internally, but there is no structured report a firm can download, file, or present to a regulator. A redaction tool without an audit report is not a legal-redaction tool.

3. **There is no path to improvement.** The base Rampart model is strong but not trained on UK legal text. Without synthetic training data and a dataset export tool, fine-tuning cannot happen, and the product cannot get better at the specific PII patterns law firms care about.

4. **No demo exists.** Firms evaluating Ormont need to see a complete run — upload a real DOCX, see detection, review spans, finalize, download output — in a single session. Without a prepared demo fixture and a known end-to-end flow, evaluation conversations stall on "show me."

This phase closes all four gaps.

## Product Principles

- **A redaction tool that cannot export an audit report is not a redaction tool.** Every redaction run must produce a downloadable, inspectable audit artifact that records every decision, timestamp, user, and policy mode.
- **Real documents are DOCX, not TXT.** The pipeline must work on the file format law firms actually use. PDF is deferred (Phase 2), but DOCX is the minimum viable format.
- **Fine-tuning requires data first.** The synthetic data generator and dataset export tool create the raw material for Rampart fine-tuning. Without these, the fine-tuning path remains theoretical.
- **Synthetic data must be realistic.** Generated documents must use genuine UK legal language, document structures, and PII placements that reflect real law firm documents. Unrealistic data degrades fine-tuning quality.
- **The demo must be repeatable and inspectable.** A firm evaluator should be able to follow a script, inspect every artifact, and verify the tool's behaviour without ambiguity.
- **Every edge case should have a known outcome.** Overlapping spans, empty text, zero-spans-allowed runs, and detection failures all need tested, documented behaviour.

## Goals

1. **DOCX text extraction** — On upload, extract text from `.docx` files using `mammoth`, store the extracted text in object storage at the `text_object_key` path, and update the document status to `ready`.
2. **Audit report export** — `GET /api/redaction-runs/:runId/audit` returns a structured audit record. The redaction report artifact contains the original document reference, run summary, full audit log, detector version, and output reference.
3. **Synthetic training data generation** — Generate 200–500 realistic UK legal documents with labelled PII spans, in Rampart's training JSONL format, stored under `data/evals/redact/`. Covers 10+ PII types across 7+ UK legal document types.
4. **Dataset export tool** — Export reviewed redaction runs as training data in Rampart's training JSONL format, mapping Ormont span categories back to Rampart's 17 entity types.
5. **Demo preparation** — A realistic DOCX skeleton argument fixture and manual end-to-end test script covering all edge cases.
6. **Fine-tuning preparation documentation** — Document the Rampart training pipeline command, infrastructure requirements, and the deployment loop so a future contributor can fine-tune without rediscovery.
7. **Polish** — Type-check all packages, run all tests, update `docs/current-product-scope.md`, update `docs/specs/redact/milestones.md`, and verify the Redaction sidebar link (activated in Phase 2) resolves to a working route.

## Non-Goals

- **PDF text extraction** — PDF redaction requires PDF manipulation libraries (pdfplumber, PyMuPDF) and position-aware redaction boxes. This is deferred to a future phase.
- **Rampart fine-tuning execution** — This phase generates the synthetic data, the export pipeline, and the documentation, but fine-tuning itself requires a rented GPU and is a post-MVP activity after data quality has been reviewed.
- **Desktop-local redaction** — Electron offline processing is still Phase 2+.
- **Batch redaction** — Multiple documents in a single redaction run is not in Phase 3.
- **Redaction policy customization** — Firm-specific rules or policy presets are not in scope.
- **BullMQ job queue** — Detection calls remain synchronous. A job queue comes with batch processing.
- **Image content redaction** — Detecting PII in embedded images within DOCX files is deferred indefinitely.

## Users

### Legal Reviewer (at a firm)

Primary user of the review UI and audit export. Needs to inspect the redaction report, verify every decision, and download the audit trail for compliance records.

### Ormont Builder

Builds and maintains the DOCX extraction pipeline, audit endpoint, and synthetic data generator. Needs clear interfaces, testable extraction, and deterministic audit output.

### Data Scientist (preparing fine-tuning)

Uses the synthetic data generator and dataset export tool to prepare training and validation sets for Rampart fine-tuning. Needs realistic documents, correct label spaces, and clean train/validation splits.

### Firm Evaluator

Evaluates Ormont Redact for procurement. Runs through the demo fixture end-to-end, inspects the audit report, checks edge-case handling, and decides whether to proceed.

### Academic Reviewer (future)

Inspects synthetic data quality, label correctness, and the fine-tuning dataset for university-partner verification of the fine-tuning claims.

## Core Use Cases

1. **Upload a DOCX skeleton argument, extract its text, and verify the extracted text is stored correctly.**
2. **Create a redaction run on a DOCX-based document, detect PII, review spans, and finalize.**
3. **Export the audit report for a finalized redaction run as JSON, HTML, or Markdown.**
4. **Generate 500 synthetic UK legal documents with labelled PII for Rampart fine-tuning.**
5. **Export reviewed redaction run decisions as training data for Rampart fine-tuning.**
6. **Walk through the demo fixture end-to-end: upload → extract → detect → review → finalize → download output + audit.**
7. **Verify edge-case behaviour: empty text, zero spans, all spans rejected, overlapping spans, detection failures, re-runs, very long documents.**

## Scope

### Release Scope

- DOCX text extraction via mammoth integrated into document upload flow
- Extracted text stored at `document_versions.text_object_key` in object storage
- Document status management: `pending` → `ready` after extraction, `failed` on failure
- DOCX with tables, headers, footers all supported (mammoth handles these)
- `.txt` extraction implemented alongside DOCX (Phase 1 relied on a request-body `text` fallback for testing; this phase implements real extraction and removes the fallback)
- `GET /api/redaction-runs/:runId/audit` endpoint
- Audit report artifact stored alongside redacted output
- Report formats: JSON (primary), HTML (secondary), Markdown (tertiary)
- Synthetic data generator script producing 200–500 documents
- 7+ UK legal document types with 10+ PII types
- Output in Rampart training JSONL format
- Dataset export tool: `data/evals/redact/exported_training_data.jsonl`
- Demo DOCX fixture (realistic skeleton argument)
- Edge-case test fixtures and manual test script
- Fine-tuning preparation documentation
- Type-checking and test pass for all affected packages
- Sidebar navigation update, scope doc update

### Deferred (Post-M3 / Phase 2)

- PDF text extraction and redaction
- Fine-tuning execution (requires rented GPU, separate budget)
- Desktop-local redaction
- Batch redaction runs
- Firm-specific policy presets
- Image-in-DOCX PII detection
- Redaction benchmark evaluation suite (to be defined in Bench PRD later)

## Domain-Specific Sections

### 1. DOCX Text Extraction

**Rationale:** UK legal documents are authored in Microsoft Word and distributed as DOCX. The entire Ormont product upload flow is built around `matter_documents` and `document_versions`, which already support any file type. The gap is that Phase 1 only extracts text from plain `.txt` files. For DOCX, an extraction step is needed between upload and redaction-readiness.

**Approach:**

- Add `mammoth` as a dependency in the API service (`services/api/package.json`). Mammoth is a mature DOCX-to-HTML/text library that handles paragraphs, tables, headers, footers, embedded images (skipped for text extraction), and common formatting. It is available as an npm package (`mammoth`) and runs in Node.js without external binaries.
- On document upload, inspect the `fileType` field of `matter_documents`. If `fileType` is `.docx`, run mammoth extraction. If `.txt`, read the file content directly (existing Phase 1 path).
- Store the extracted text at the `text_object_key` path in object storage. The `document_versions` table already has this column.
- After extraction, update `document_versions.document_status` to `ready`. (`document_status` and `failure_reason` are new columns added by migration `0006_document_extraction.sql`, scoped to this phase — see FR1.9.)
- On redaction run creation (`POST /api/documents/:documentId/redaction-runs`), check `document_status`. If not yet `ready`, trigger extraction synchronously before creating the run. If extraction fails, the run goes to `failed` with a `failure_reason` field.
- Handle extraction failures: if mammoth throws (corrupt DOCX, unsupported format), catch the error, set `document_status` to `failed`, record the error message in `failure_reason`.

**Error states:**

| Condition | Behaviour |
|-----------|-----------|
| DOCX uploaded, extraction succeeds | Status → `ready`, text stored at `text_object_key` |
| DOCX uploaded, extraction fails | Status → `failed`, `failure_reason` set |
| TXT uploaded | Read inline, status → `ready` |
| PDF uploaded | Blocked at upload with "PDF not yet supported" error |
| Run created before extraction done | Trigger extraction synchronously |
| Object storage unavailable during extraction | Status → `failed`, `failure_reason: "object storage unavailable"` |

**Mammoth configuration:**

```typescript
import mammoth from 'mammoth'

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  if (result.messages && result.messages.length > 0) {
    // Log warnings (formatting loss, unsupported features) but don't fail
    logger.warn('mammoth extraction warnings', result.messages)
  }
  return result.value
}
```

`mammoth.extractRawText` returns the text content of the DOCX without formatting. This is sufficient for Rampart detection, which operates on raw text. The original DOCX is always preserved in object storage for later output regeneration or download.

### 2. Audit Report Export

**Rationale:** Law firms need a downloadable audit record for compliance. The internal audit log (Phase 1 pattern: `appendAuditLog` with action types `redaction.run_create`, `redaction.span_decision`, `redaction.finalize`) is machine-readable but not suitable for direct consumption. The audit report wraps it into a structured document.

**API Endpoint:**

```
GET /api/redaction-runs/:runId/audit
Query: format? (optional, default: 'json')
  - 'json' -> application/json
  - 'html' -> text/html
  - 'markdown' -> text/markdown
Response 200: structured audit report
Response 404: run not found
Response 403: user not in run's organisation
```

**Audit report structure (JSON):**

```json
{
  "redactionRunId": "red_abc123",
  "generatedAt": "2026-06-28T14:30:00Z",
  "originalDocument": {
    "documentId": "doc_001",
    "versionId": "ver_001",
    "filename": "skeleton-argument-smith-v-jones.docx"
  },
  "redactionRunSummary": {
    "totalSpans": 24,
    "byCategory": {
      "person_name": 8,
      "address": 3,
      "email": 2,
      "phone": 1,
      "date": 4,
      "national_insurance": 1,
      "case_reference": 3,
      "organisation_name": 2
    },
    "bySource": {
      "rampartModel": 17,
      "rampartDeterministic": 3,
      "ukSupplement": 4
    },
    "decisionsBreakdown": {
      "accepted": 18,
      "rejected": 3,
      "overriddenRedact": 1,
      "overriddenKeep": 1,
      "pseudonymised": 1
    }
  },
  "detectorVersion": "rampart-0.1.3",
  "policyMode": "internal_ai_minimisation",
  "outputArtifact": {
    "artifactId": "art_001",
    "artifactType": "redaction_output",
    "outputMode": "redacted",
    "objectKey": "org/org_abc/matters/matter_001/artifacts/art_001"
  },
  "auditLog": [
    {
      "action": "redaction.run_create",
      "userId": "user_001",
      "timestamp": "2026-06-28T14:00:00Z",
      "details": { "policyMode": "internal_ai_minimisation" }
    },
    {
      "action": "redaction.span_decision",
      "userId": "user_001",
      "timestamp": "2026-06-28T14:05:00Z",
      "details": {
        "spanId": "span_001",
        "spanText": "Mr James Cartwright",
        "category": "person_name",
        "decision": "accept"
      }
    },
    {
      "action": "redaction.finalize",
      "userId": "user_001",
      "timestamp": "2026-06-28T14:10:00Z",
      "details": { "outputMode": "redacted" }
    }
  ],
  "reviewerInfo": {
    "userId": "user_001",
    "reviewedAt": "2026-06-28T14:10:00Z"
  }
}
```

Each run has exactly one output artifact (type `redaction_output`), determined by the `outputMode` chosen at finalize (PRD 2). A pseudonymised output requires a separate run. Note on `spanText`: the audit *log table* stores no raw document text (PRD 2 security requirement). The `spanText` values shown in the report are enriched from the run's `spans_json` at report generation time — the report artifact therefore contains PII and is access-controlled per SEC1.

**HTML/Markdown formats:**

The HTML export is a self-contained page suitable for printing or filing. The Markdown export is suitable for embedding in case notes or email. Both formats contain the same information as the JSON export but in human-readable layouts.

**Artifact storage:**

The audit report is stored as an `artifact` row with `artifactType: 'redaction_report'` alongside the redacted output. The report is generated at finalize time and stored in object storage. Subsequent reads of `GET /api/redaction-runs/:runId/audit` serve the stored report (or generate on demand if missing — e.g., during development).

### 3. Synthetic Training Data Generation

**Rationale:** Rampart achieves 98.42% private-term recall on the OpenPII 30k held-out test set, but legal text has specific PII patterns and document structures that the base model has not been trained on. The synthetic data generator creates the raw material to close this gap through fine-tuning.

**Document types (7+):**

| Type | Description | Typical PII |
|------|-------------|-------------|
| Skeleton argument | Legal arguments summarising a party's position | Person names, case references, dates |
| Witness statement | Sworn statement of fact | Person names, addresses, dates, NI numbers, organisation names |
| Case report | Anonymised judgment summary | Person names, case references, dates |
| Client letter | Correspondence between solicitor and client | Person names, addresses, emails, phone numbers, dates, case references |
| Attendance note | Record of a meeting or call | Person names, organisation names, dates, case references, phone numbers |
| Court form | Official court filing form | Person names, addresses, NI numbers, passport numbers, dates, case references |
| Pleadings | Statement of case (Particulars of Claim, Defence) | Person names, addresses, organisation names, dates, case references, bank account numbers |

**PII types to include (12):**

| Category | Description | Examples | Ormont label |
|----------|-------------|----------|--------------|
| Person with honorific | Named individual with title | Mr James Cartwright, Dr Sarah Chen, Ms Aisha Patel | `person_name` |
| UK address | Postal address with postcode | 42 Belgrave Road, Leicester LE4 5AB | `address` |
| Email | Email address | j.cartwright@lawfirm.co.uk | `email` |
| UK phone | UK-format phone number | 020 7946 0958, 07700 900482, +44 20 7946 0958 | `phone` |
| Legal date | Date in legal format | 15 March 2024, the 15th day of March 2024 | `date` |
| NI number | National Insurance number | JX 12 34 56 D, JX123456D | `national_insurance` |
| Passport number | UK passport number | 987654321 | `passport` |
| Case reference | Internal firm reference | REF/2024/0123, CLAIM-2024-Smith-0042 | `case_reference` |
| Bank account | Bank account or sort code | 12345678 / 12-34-56 | `account_number` |
| Organisation | Firm or company name | Smith & Jones Solicitors LLP, HM Courts Service | `organisation_name` |
| URL | Personal or case-related URL | https://solicitors.law/our-team/jcartwright | `url` |
| Secret | Password or API key | Password: TempPass123! | `secret` |

**Output format (Rampart training schema):**

```jsonl
{"text": "IN THE HIGH COURT OF JUSTICE\nQUEEN'S BENCH DIVISION\n\nCLAIM No: REF/2024/0123\n\nBETWEEN:\n\nMr James Cartwright\nand\nMrs Sarah Chen\n\nSKELETON ARGUMENT OF THE CLAIMANT\n\n1. The Claimant, Mr James Cartwright of 42 Belgrave Road, Leicester LE4 5AB, is a retired school teacher born on 10 June 1956. His National Insurance number is JX 12 34 56 D.\n\n2. The Defendant, Mrs Sarah Chen, is a solicitor employed by Smith & Jones Solicitors LLP of 78 High Holborn, London WC1V 6XX. Her email address is s.chen@smithjones.co.uk and her direct telephone number is 020 7946 0958.\n\n3. This claim arises from a road traffic accident on 15 March 2024 at approximately 14:30 hours...", "spans": {"private_person: James Cartwright": [[94, 111], [184, 199]], "private_address: 42 Belgrave Road, Leicester LE4 5AB": [[203, 242]], "private_person: Mr James Cartwright": [[181, 201]], "private_date: 10 June 1956": [[269, 282]], "national_insurance: JX 12 34 56 D": [[314, 327]], "private_person: Mrs Sarah Chen": [[357, 372]], "private_person: Sarah Chen": [[389, 400]], "organisation_name: Smith & Jones Solicitors LLP": [[421, 449]], "private_address: 78 High Holborn, London WC1V 6XX": [[453, 488]], "private_email: s.chen@smithjones.co.uk": [[511, 535]], "private_phone: 020 7946 0958": [[567, 580]], "private_date: 15 March 2024": [[624, 638]]}, "info": {"id": "legal_001", "source": "ormont.synthetic"}}
```

**Custom label space file:**

```json
{
  "category_version": "ormont_legal_v1",
  "span_class_names": [
    "O",
    "private_person",
    "private_address",
    "private_email",
    "private_phone",
    "private_date",
    "account_number",
    "secret",
    "private_url",
    "national_insurance",
    "case_reference",
    "passport",
    "drivers_license",
    "government_id",
    "ip_address"
  ]
}
```

The label space MUST be a superset of every base-model label the product consumes: fine-tuning against a label space that drops a base label removes the model's ability to detect that class. The list above therefore retains passport, drivers license, government id, and IP address alongside the new custom labels.

**Label space roadmap (`ormont_legal_v2`, post-MVP):**

Legal redaction differs from generic PII detection in one structural way: whether a span is redacted depends on the *role* of the entity, not just its type. A judge, counsel, or instructing solicitor is on the public record and is normally kept; a claimant, witness, or client is normally redacted; a child or protected party under an anonymity order MUST be redacted (statutory consequence, not preference). All of these are `person_name` in v1, which means neither the model nor the policy layer can distinguish them — the reviewer carries the full burden.

- `ormont_legal_v1` (this phase) is deliberately scoped to fixed-format identifiers (`national_insurance`, `case_reference`, `secret`) because ~300 synthetic documents cannot train a person-role taxonomy without degrading base-model recall.
- `ormont_legal_v2` is the named direction: split `person_name` into `person_party`, `person_professional` (on-record: judges, counsel, solicitors), and `person_protected` (children, anonymity-order subjects); consider `medical_info` for PI matters. Role-aware labels give `policy_mode` real differentiation: e.g. `external_sharing` keeps `person_professional`, `internal_ai_minimisation` redacts everything.
- Role subtype detection is context-dependent ("His Honour Judge ___" vs "the Claimant, ___") — exactly what a token classifier can learn and what a downstream policy layer cannot recover once detection has flattened everything to `person_name`. This is why roles belong in the model label space, not only in policy.
- Legally privileged material detection is explicitly out of scope for the token classifier: privilege is passage-level, not span-level, and requires a different mechanism if ever pursued.
- v2 requires no schema rewrite: the Ormont category schema and the label space are versioned, and both mapping layers (`rampart-map.ts` inbound, dataset export outbound) are explicit. v2 is a data + fine-tune exercise, provided the role metadata below is captured from v1 onwards.
- Reviewer decisions are also v2 signal: a reviewer rejecting a `person_name` span on a judge's name is implicit role labelling. Rejection records persist in `decisions_json` and can be mined when v2 training data is assembled — no additional tooling is required in this phase.

Note: `organisation_name` and `passport` handling differs between Ormont and Rampart's base label set. In the synthetic data, these are mapped:
- `organisation_name` → `O` (ignored during fine-tuning; the model learns to not flag organisation names as PII unless the firm's policy requires it)
- `passport` → mapped to `PASSPORT` which Rampart already supports natively
- `case_reference` → the custom label space includes this; it is a new label not present in base Rampart

**Generation script requirements:**

The generation script (`scripts/generate-synthetic-data.ts` or equivalent) must:

1. **Template-based generation**: Define templates for each document type with placeholders for PII. Each template is a realistic document structure with variable insertion points.

2. **PII value generation**: Use realistic generators for each PII type:
   - Person names: Use a curated list of 100+ common UK names with appropriate honorifics. Mix ethnicities and genders. Include some names that could also be case citations (e.g., "Smith", "Jones") to test context awareness.
   - Addresses: Use real UK street names and postcodes (anonymised). Include single-line and multi-line formats.
   - Emails: Generate from name + domain patterns (john.smith@lawfirm.co.uk, info@chambers.co.uk).
   - Phone numbers: Generate in multiple UK formats (landline, mobile, international prefix).
   - Dates: Generate in legal formats including "15 March 2024", "the 15th day of March 2024", "15/03/2024".
   - NI numbers: Generate valid-format NI numbers (2 letters, 6 digits, 1 letter — with and without spaces).
   - Passport numbers: 9-digit UK passport format.
   - Case references: Multiple internal formats (REF/2024/0123, CLAIM-2024-Smith-0042, CR-2024-1234).
   - Bank accounts: 8-digit account number + 6-digit sort code.

3. **Span computation**: For each generated document, compute start and end character offsets for every PII instance. Handle multi-occurrence PII (same name appears multiple times).

3a. **Role metadata annotation**: The generator knows the role of every person it inserts (claimant, defendant, witness, expert, judge, counsel, solicitor, child/protected party). Record this in each JSONL entry's `info` field as a `roles` map (e.g. `"roles": {"James Cartwright": "party", "Sarah Chen": "professional", "Mr Justice Holroyd": "professional"}`) even though `ormont_legal_v1` collapses all of them to `private_person`. This is nearly free at generation time and is the prerequisite for training `ormont_legal_v2`'s role-split labels (see Label space roadmap) without regenerating the corpus. Every generated document MUST include judges, counsel, or solicitors alongside party names so the v2 role distinction has both classes represented.

4. **Overlapping span handling**: Include documents with overlapping entities:
   - "Mr David Smith of Smith & Jones" — where "Smith" could be a name or organisation reference
   - "Smith v Jones" — case reference that looks like names
   - "20 High Street, London SW1A 1AA" — address containing a postcode (should be single span)

5. **Edge case coverage**: Generate specific documents exercising:
   - Empty text (trivial: just metadata)
   - Text with no PII (court forms with only case numbers that should be flagged)
   - All PII types present in a single document (stress test)
   - Documents with only UK supplement PII (NI numbers, case references — no model-detectable PII)
   - Very long documents spanning many 512-token detection chunks (long witness statements with repeated PII, exercising chunk-boundary reassembly)
   - Documents where names look like case citations ("Mr Smith submits... In Smith v Jones, the court held...")

6. **Validation**: After generation, validate every document:
   - Every span start/end offset is valid (start < end, within text length)
   - Every span's `text` slice matches the original text at those offsets
   - No overlaps are inconsistent (same text covered by two compatible spans is fine; contradictory coverage is flagged)
   - All required fields present (`text`, `spans`, `info`)

7. **Train/validation split**: Split the generated documents into 80% training and 20% validation sets (random stratified by document type).

8. **Output files** (stored in `data/evals/redact/`):
   - `synthetic_train.jsonl` — training set
   - `synthetic_validation.jsonl` — validation set
   - `custom_label_space.json` — label space definition
   - `generation_manifest.json` — summary of what was generated (document count per type, PII count per category, edge cases covered)
   - `validation_report.json` — results of the validation step (pass/fail per document, warnings)

**Volume targets:**

| Metric | Target |
|--------|--------|
| Total documents | 300 (minimum viable) |
| Training set | 240 |
| Validation set | 60 |
| Min PII instances per document | 3 |
| Max PII instances per document | 25 |
| Documents with overlapping spans | ≥ 10 |
| Documents with zero PII | ≥ 5 |
| Documents with only UK supplement PII | ≥ 10 |
| Document types covered | ≥ 7 |
| Unique person names | ≥ 80 |
| Unique addresses | ≥ 50 |
| Person spans with role metadata | 100% |
| Documents containing on-record professionals (judge/counsel/solicitor) | 100% |

**Realism guidelines:**

- Use actual UK legal phrasing patterns: "The Claimant submits...", "It is respectfully submitted that...", "The Defendant contends...", "Pursuant to CPR 3.1(2)(a)...", "For the reasons set out below..."
- Use accurate court names: "High Court of Justice, Queen's Bench Division", "Central London County Court", "Royal Courts of Justice"
- Use realistic case numbering formats: firms use varied formats, include at least 5 different formats
- Include legal boilerplate paragraphs (standard clauses) alongside PII-bearing content
- Mix short documents (1 paragraph) and long documents (multiple pages)
- Include typographical inconsistencies (extra spaces, inconsistent capitalisation) in some documents to test detection robustness

### 4. Dataset Export Tool

**Rationale:** Every reviewed redaction run represents ground-truth data about what is and is not PII in legal text. The dataset export tool captures that data and converts it into Rampart's training format, creating a feedback loop: real usage → human-reviewed decisions → training data → improved model.

**Tool:**

Script at `scripts/export-training-data.ts` (or similar) that:

1. Queries all finalized redaction runs marked as human-reviewed (not auto-finalized).
2. For each run, loads the extracted text and all finalised decisions.
3. For each span where the human accepted, pseudonymised, or overrode to redact (`override_redact`) the detection, creates a training entry using the span's category mapped to the Rampart label space. (`override_redact` is the strongest positive signal — a human asserting PII the model missed or under-weighted.)
4. For each span where the human rejected the detection, the span is **excluded** from the output (the model should not learn to flag that text as PII).
5. For each span where the human chose `override_keep`, the span is also excluded (the human explicitly said this is not PII).
6. Outputs a single JSONL file: `data/evals/redact/exported_training_data.jsonl`.

**Category mapping (Ormont → Rampart):**

| Ormont label | Rampart label |
|--------------|---------------|
| `person_name` | `GIVEN_NAME` + `SURNAME` |
| `email` | `EMAIL` |
| `phone` | `PHONE` |
| `address` | `BUILDING_NUMBER` + `STREET_NAME` + `SECONDARY_ADDRESS` |
| `government_id` | `SSN` / `GOVERNMENT_ID` / `TAX_ID` |
| `account_number` | `CREDIT_CARD` / `BANK_ACCOUNT` / `ROUTING_NUMBER` |
| `passport` | `PASSPORT` |
| `drivers_license` | `DRIVERS_LICENSE` |
| `url` | `URL` |
| `ip_address` | `IP_ADDRESS` |
| `date` | `DATE` / `DOB` |
| `secret` | custom: `secret` |
| `national_insurance` | custom: `national_insurance` |
| `case_reference` | custom: `case_reference` |
| `organisation_name` | Excluded (not in label space) |

**Quality gates:**

- Only include runs where the reviewer manually reviewed every span (no un-reviewed spans remain at finalize time). This prevents unverified detections from entering the training set.
- If a run was finalized with un-reviewed spans, log a warning and skip that run unless `--include-partial` flag is passed.
- Validate output: every JSONL line must parse, every span must reference valid offsets, every label must be in the custom label space.

### 5. Demo Preparation

**Demo fixture document:**

A realistic skeleton argument in DOCX format, approximately 3–5 pages, containing:

- Multiple person names with honorifics: Mr James Cartwright (Claimant), Mrs Sarah Chen (Defendant), Dr. Michael O'Brien (expert witness)
- Addresses with UK postcodes: 42 Belgrave Road, Leicester LE4 5AB (Claimant's address); 78 High Holborn, London WC1V 6XX (Defendant's solicitors)
- Dates of birth and hearing dates: The Claimant was born on 10 June 1956; the hearing is listed for 15 March 2024
- National Insurance numbers: JX 12 34 56 D (Claimant's NI number)
- Case references: REF/2024/0123, CLAIM-2024-Smith-0042
- Email addresses: j.cartwright@personal.email, s.chen@smithjones.co.uk
- Phone numbers: 020 7946 0958, 07700 900482, +44 20 7946 0958
- Bank account references: Account number 12345678, sort code 12-34-56 (Claimant's account for costs payments)
- Organisation names: Smith & Jones Solicitors LLP, HM Courts & Tribunals Service, Leicester Royal Infirmary
- Edge case: Names that also appear as case citations: "In Smith v Jones [2023] EWHC 1234 (QB), the court held... This is distinguishable from the present case where Mr Smith..."
- On-record professionals: Mr Justice Holroyd (presiding judge), Ms Priya Sharma of counsel. In v1 these are detected as `person_name` like any other name; the demo script uses them to show the reviewer reject flow ("public-record names are kept") and to explain the planned `ormont_legal_v2` role-aware labels (see Label space roadmap).

Store at `data/evals/redact/demo-fixture.docx` with a companion JSON metadata file describing the expected spans.

**Scope honesty:** the demo is a demonstration, not an evaluation. It shows the complete workflow on one deliberately dense fixture; it does not establish precision or recall on legal text. The expected-spans comparison (FR5.2) is a regression smoke check, not a recall claim, and must not be presented to firms as accuracy evidence. Formal benchmarking on a held-out legal corpus is deferred to the Bench PRD and is the prerequisite for making any quantitative accuracy claim in evaluations.

**End-to-end manual test script:**

```
=== End-to-End Demo Test Script ===

Prerequisites:
- Redact api running (http://localhost:3000)
- Rampart model loaded (runs in-process, no separate service)
- Authenticated as a user with access to an org with matters

Step 1: Upload demo fixture
  POST /api/matters/:matterId/documents
  Body: multipart with demo-fixture.docx, fileType: .docx
  Expected: 201, documentStatus: 'pending'

Step 2: Verify text extraction
  GET /api/matters/:matterId/documents/:documentId
  Expected: documentStatus: 'ready'
  Verify text_object_key is set and accessible

Step 3: Create redaction run
  POST /api/documents/:documentId/redaction-runs
  Body: { policyMode: 'internal_ai_minimisation' }
  Expected: 201, status: 'pending' then transitions to 'detecting' then 'ready_for_review'

Step 4: Verify spans detected
  GET /api/redaction-runs/:runId
  Expected: spans array non-empty, categories distributed across
  person_name, address, email, phone, date, national_insurance
  At least 15 spans total (the fixture is dense)

Step 5: Review spans
  For each span, POST /api/redaction-runs/:runId/spans/:spanId/decision
  Body: { decision: 'accept' } for most, { decision: 'reject' } for some
  Verify summary updates correctly

Step 6: Finalize run
  POST /api/redaction-runs/:runId/finalize
  Body: { outputMode: 'redacted' }
  Expected: 200, status: 'finalized', outputArtifactId set

Step 7: Download redacted output
  GET /api/artifacts/:artifactId/download
  Expected: text content with [REDACTED] in place of all accepted spans
  Verify no original PII strings remain in output

Step 8: Download audit report
  GET /api/redaction-runs/:runId/audit
  Expected: JSON with full audit log, run summary, detector version
  Verify every decision recorded with correct userId and timestamp

Step 9: Pseudonymised output (second run — finalized runs cannot be re-finalized)
  POST /api/documents/:documentId/redaction-runs
  Review spans as in Step 5, then:
  POST /api/redaction-runs/:newRunId/finalize
  Body: { outputMode: 'pseudonymised' }
  Expected: tokens like [PERSON_1], [ADDRESS_1] replacing PII consistently

Step 10: Re-run on same document
  POST /api/documents/:documentId/redaction-runs  (same doc, new run)
  Expected: new run, new spans, independent from first run
```

**Edge cases to verify:**

| Edge case | Expected behaviour |
|-----------|-------------------|
| Overlapping spans (Rampart + UK supplement overlap) | Rampart span kept, UK supplement span dropped. System logs overlap with confidence comparison. |
| Empty text (`document` with 0 bytes) | Run created, status → `ready_for_review` with 0 spans, no error |
| Text with no detectable PII | Run created, 0 spans, status → `ready_for_review`, reviewer sees empty state |
| All spans rejected | Finalize with 0 accepted spans. Output is identical to original text. Report shows 0 modifications. |
| Finalize without reviewing all spans | Allowed but warning shown: "X spans unreviewed — unreviewed spans are left as-is in the output" (per PRD 2: no automated redaction without human review). Audit log records the unreviewed span ids at finalize. |
| Re-run on same document | Independent run, new span IDs, new detection results (model inference is deterministic but decisions start fresh) |
| Detection failure (model load error, inference error) | Post returns `redaction_detection_failed` error. Run status → `failed`. `failure_reason` set. |
| DOCX with tables | Table text extracted row by row, spans detected in table cells. No text lost. |
| DOCX with headers/footers | Header/footer text extracted and available for detection (names in headers). |
| Very long documents | Document chunked at 512-token boundaries. All chunks processed, spans reassembled with correct offsets. |

### 6. Fine-Tuning Preparation (Documentation Only)

**Purpose:** Document the fine-tuning process so a future contributor can run it without rediscovery.

**Command reference:**

Rampart ships as a frozen ONNX artifact. Fine-tuning requires the Python training pipeline from the Rampart GitHub repository (`nationaldesignstudio/rampart`). The model is a MiniLM-L6-H384 encoder fine-tuned with a 35-label BIO head.

```bash
# Clone the Rampart repo (contains the training pipeline)
git clone https://github.com/nationaldesignstudio/rampart
cd rampart

# Install training dependencies
pip install torch transformers datasets onnx onnxruntime

# Prepare training data in Rampart's JSONL format (text + BIO spans)
# The synthetic data generator and dataset export tool produce this format

# Fine-tune the model
python scripts/train.py \
  --train-data /path/to/synthetic_train.jsonl \
  --validation-data /path/to/synthetic_validation.jsonl \
  --label-space /path/to/custom_label_space.json \
  --output-dir /path/to/checkpoint

# Export the fine-tuned model to ONNX (Q4 quantized)
python scripts/export_onnx.py \
  --checkpoint /path/to/checkpoint \
  --output /path/to/rampart-ormant-legal-q4.onnx
```

**Infrastructure requirements:**

| Resource | Specification | Cost estimate |
|----------|--------------|---------------|
| GPU | NVIDIA T4 (16GB VRAM) or better | ~$0.50/hr (rented cloud) |
| Training time (500 docs) | 1–2 hours | ~$0.50–$1.00 per training run |
| Storage | 2GB per checkpoint | Negligible |
| Software | Python 3.10+, `torch`, `transformers`, `datasets`, `onnx` | Free/open-source |

**The fine-tuning loop:**

```
┌──────────────────────────────────────────────────┐
│  Ship base Rampart model                         │
│  (nationaldesignstudio/rampart via npm)          │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Collect reviewed decisions from redaction runs  │
│  (dataset export tool → exported_training_data)  │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Export dataset → JSONL in Rampart BIO format    │
│  Merge with synthetic data if needed             │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Fine-tune on rented GPU                         │
│  python scripts/train.py /path/to/train.jsonl    │
│     --validation-data ...                        │
│     --label-space ...                            │
│     --output-dir ./checkpoint                    │
│  Export to ONNX Q4                               │
│  python scripts/export_onnx.py                   │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Deploy fine-tuned ONNX model                    │
│  1. Upload ONNX to object storage                │
│  2. Update REDACT_MODEL_ID env var to local path │
│  3. Restart API (model loads from new path)      │
│  4. Verify: run demo fixture, compare spans      │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Repeat (collect more data, fine-tune again)     │
└──────────────────────────────────────────────────┘
```

**Checkpoint deployment:**

1. Upload the fine-tuned ONNX model to object storage: `op_artifacts/redact-models/ormont_legal_v1/2026-07-01/rampart-legal-q4.onnx`
2. Update the `REDACT_MODEL_ID` environment variable in the API service configuration to point to the local path where the ONNX model is stored (or a HuggingFace repo id if published).
3. Restart the API service. The Rampart guard loads the new model on next detection request.
4. Test by running the demo fixture through the pipeline and comparing the span set against the baseline. Expected: more accurate detection on UK legal patterns, fewer missed NI numbers and case references.

**Versioning:**

- Store checkpoints in object storage with versioned paths: `op_artifacts/redact-models/ormont_legal_v1/2026-07-01/`
- Record checkpoint metadata in a `checkpoint_versions` table (simple: id, version_label, object_key, trained_at, training_data_summary, validation_metrics)
- The `detector_version` field in `redaction_runs` references the checkpoint version used for that run

### 7. Polish

**Type-checking:**

Commands to pass with no errors:

```bash
pnpm --filter @ormont/redaction-policy typecheck
pnpm --filter @ormont/api typecheck
pnpm --filter @ormont/app-shell typecheck
```

**Testing:**

Commands to pass with no failures:

```bash
pnpm --filter @ormont/redaction-policy test
pnpm --filter @ormont/api test
pnpm --filter @ormont/app-shell test
```

**Documentation updates:**

- `docs/current-product-scope.md`: Move "Redaction" from "Visible But Not Implemented" to "Implemented Navigation". Remove "(planned)" badge from the Redaction sidebar entry.
- `docs/specs/redact/milestones.md`: Update M3 completion notes:
  - M3 milestone: DOCX text extraction, audit export, synthetic data, demo preparation
  - Mark M3 as complete with date and PR/commit reference
  - Note what was deferred (PDF, fine-tuning execution, desktop-local)

**Sidebar navigation:**

The Redaction sidebar entry was activated in Phase 2 (Redact PRD 2, FR11). This phase verifies the link resolves to a working route end-to-end and removes any remaining "(planned)" badge.

## Functional Requirements

### FR1: DOCX Text Extraction

| ID | Requirement |
|----|-------------|
| FR1.1 | On document upload with `fileType == 'docx'`, extract text using `mammoth.extractRawText` and store at `document_versions.text_object_key` |
| FR1.2 | On document upload with `fileType == 'txt'`, store file content directly at `text_object_key` |
| FR1.3 | On document upload with `fileType == 'pdf'`, reject with clear error: "PDF files are not yet supported for redaction. Please upload DOCX or TXT files." |
| FR1.4 | After successful extraction, set `document_versions.document_status` to `ready` |
| FR1.5 | On extraction failure (mammoth throws), set `document_versions.document_status` to `failed` and record `document_versions.failure_reason` |
| FR1.6 | On redaction run creation, if `document_status != 'ready'`, trigger extraction synchronously before creating the run |
| FR1.7 | Log mammoth extraction warnings (formatting loss, unsupported features) but do not treat them as failures |
| FR1.8 | Preserve original DOCX in object storage for later download or reprocessing |
| FR1.9 | Migration `0006_document_extraction.sql` MUST add `document_status` (check constraint: `'pending'`, `'ready'`, `'failed'`) and `failure_reason` (text, nullable) columns to `document_versions` — these columns do not exist prior to this phase |
| FR1.10 | Remove the Phase 1 `text` request-body fallback from `POST /api/documents/:documentId/redaction-runs` — runs must read text exclusively from `text_object_key` |

### FR2: Audit Report Export

| ID | Requirement |
|----|-------------|
| FR2.1 | `GET /api/redaction-runs/:runId/audit` returns the audit report for a finalized run |
| FR2.2 | The audit report contains: original document reference, redaction run summary (total spans by category by source, decisions breakdown), detector version, redacted/pseudonymised output references, full audit log, reviewer info, policy mode |
| FR2.3 | Support three output formats: JSON (primary, `application/json`), HTML (`text/html`), Markdown (`text/markdown`) |
| FR2.4 | The audit report is stored as an artifact with type `redaction_report` at finalize time |
| FR2.5 | Subsequent reads serve the stored artifact (not regenerated from log table) |
| FR2.6 | Return 404 if run not found, 403 if user not in run's organisation, 400 if run not yet finalized |

### FR3: Synthetic Training Data Generation

| ID | Requirement |
|----|-------------|
| FR3.1 | Generate 200–500 synthetic UK legal documents with labelled PII spans |
| FR3.2 | Cover at least 7 document types: skeleton arguments, witness statements, case reports, client letters, attendance notes, court forms, pleadings |
| FR3.3 | Cover at least 12 PII types: person names, addresses, emails, phones, dates, NI numbers, passport numbers, case references, bank accounts, organisations, URLs, secrets |
| FR3.4 | Output in Rampart training JSONL format with `text`, `spans`, and `info` fields |
| FR3.5 | Generate a custom label space file (`custom_label_space.json`) defining `ormont_legal_v1` |
| FR3.6 | Validate all documents: correct offsets, correct text slices, valid labels |
| FR3.7 | Split into train (80%) and validation (20%) sets |
| FR3.8 | Include edge-case documents: overlapping spans, zero PII, regex-only PII, names-as-case-citations |
| FR3.9 | Store outputs in `data/evals/redact/` |
| FR3.10 | Generate a manifest (`generation_manifest.json`) summarising composition |
| FR3.11 | Generate a validation report (`validation_report.json`) documenting pass/fail per document |
| FR3.12 | Annotate every generated person span with role metadata (`party`, `professional`, `witness`, `protected`) in the entry's `info.roles` map, and include on-record professionals (judges, counsel, solicitors) in every document — captured for `ormont_legal_v2` even though v1 collapses all roles to `private_person` |

### FR4: Dataset Export Tool

| ID | Requirement |
|----|-------------|
| FR4.1 | Script exports finalized redaction runs with human-reviewed decisions as training data |
| FR4.2 | Map Ormont span categories to Rampart label space per the mapping table |
| FR4.3 | Exclude rejected and `override_keep` spans from output |
| FR4.4 | Skip runs finalized with un-reviewed spans unless `--include-partial` flag passed |
| FR4.5 | Output: `data/evals/redact/exported_training_data.jsonl` in Rampart BIO format |
| FR4.6 | Validate output format before writing |

### FR5: Demo Preparation

| ID | Requirement |
|----|-------------|
| FR5.1 | Create `data/evals/redact/demo-fixture.docx` — a 3–5 page skeleton argument with 10+ PII instances across 8+ categories |
| FR5.2 | Create companion metadata file `demo-fixture-expected-spans.json` documenting expected spans for automated validation |
| FR5.3 | Document manual test script covering all 10 steps |
| FR5.4 | Verify all edge cases listed in Edge Cases section |

### FR6: Polish

| ID | Requirement |
|----|-------------|
| FR6.1 | `pnpm --filter @ormont/redaction-policy typecheck` passes with zero errors |
| FR6.2 | `pnpm --filter @ormont/api typecheck` passes with zero errors |
| FR6.3 | `pnpm --filter @ormont/app-shell typecheck` passes with zero errors |
| FR6.4 | `pnpm --filter @ormont/redaction-policy test` passes with zero failures |
| FR6.5 | `pnpm --filter @ormont/api test` passes with zero failures |
| FR6.6 | `docs/current-product-scope.md` updated: Redaction moved to Implemented Navigation |
| FR6.7 | `docs/specs/redact/milestones.md` updated with M3 completion notes |
| FR6.8 | Redaction sidebar entry (activated in Phase 2, PRD 2 FR11) verified to resolve to a working route; any remaining "(planned)" badge removed |
| FR6.9 | `NOTICE` file added to the repo crediting `@nationaldesignstudio/rampart` (CC BY 4.0), and attribution surfaced in any user-facing about/licences page |

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR1 | DOCX extraction must complete within 5 seconds for a 20-page document |
| NFR2 | Audit report generation must complete within 2 seconds for a run with up to 200 spans |
| NFR3 | Synthetic data generation must complete within 5 minutes for 500 documents |
| NFR4 | Object storage must be available for extraction; if unavailable, extraction fails gracefully with a clear error |
| NFR5 | All API endpoints must return proper JSON error responses with Ormont error codes |
| NFR6 | Audit log entries must be append-only and immutable after creation |

## Security and Compliance

| ID | Requirement |
|----|-------------|
| SEC1 | The audit report contains PII in the original text (via span excerpts). Access to `GET /api/redaction-runs/:runId/audit` must be org-scoped and auth-guarded, same as the redaction run itself |
| SEC2 | Synthetic data must use fabricated PII, not real personal data. No real names, addresses, or contact details from any actual person or case |
| SEC3 | The dataset export tool must not export documents from different organisations into the same file. Each organisation's fine-tuning data must be kept separate |
| SEC4 | Checkpoint files (fine-tuned weights) stored in object storage must be access-controlled. Checkpoints contain model weights derived from organisation's data |
| SEC5 | Text extraction (mammoth) must run server-side only. The extraction logic must never be exposed client-side |
| SEC6 | Original DOCX files and extracted text must have the same access controls: org-scoped, matter-scoped |
| SEC7 | Audit report artifacts contain PII (span excerpts) and follow the matter lifecycle: deleting a matter or document version deletes its redaction runs, output artifacts, and audit report artifacts. Audit log *table* rows are retained append-only and contain no raw text (per PRD 2), so erasure requests do not break the audit trail |
| SEC8 | Attribution: Rampart is CC BY 4.0 — a `NOTICE` file (or equivalent repo + user-facing attribution) crediting Rampart must ship with the product (FR6.9) |

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `mammoth` npm package | Available | Add to `services/api/package.json` |
| Text extraction slot (`text_object_key` column) | Done (migration 0002) | Already exists on `document_versions` |
| Artifacts table with `redaction_report` type | Done (migration 0002) | Enum includes `redaction_report` |
| Audit log function (`appendAuditLog`) | Done (`database.ts`) | Supports action types `redaction.run_create`, `redaction.span_decision`, `redaction.finalize` |
| Object storage for text and output | Needs verification | `object_key` pattern defined; actual upload code may need wiring |
| Rampart custom label space | New | Defined in this PRD as `ormont_legal_v1` |
| Migration `0006_document_extraction.sql` (`document_status`, `failure_reason` on `document_versions`) | New | Defined in this PRD (FR1.9) |
| Redact PRD 1: Detection Pipeline | Assumed complete | Worker, supplement, merge, database queries |
| Redact PRD 2: Review and Output | Assumed complete | Review UI, decisions, finalize, pseudonymisation |
| Synthetic data generation scripts | New | Node.js/TypeScript scripts under `scripts/` |
| Dataset export tool | New | Node.js/TypeScript script under `scripts/` |

See sibling PRDs: [Redact PRD 1: Detection Pipeline](redact-1-detection.md), [Redact PRD 2: Review and Output](redact-2-review-output.md).

## Rollout

### Phase 1: Internal Verification (Week 9)

- DOCX extraction merged and tested with 10+ real DOCX files (various complexity)
- Extraction failure modes verified (corrupt DOCX, empty DOCX, mammoth timeout)
- Mammoth dependency evaluated: if `mammoth` proves unreliable for complex legal DOCX, fall back to `docx4js` or `textract`
- Audit endpoint implemented and tested with finalized runs
- Internal demo walkthrough by at least 2 team members

### Phase 2: Synthetic Data + Export (Week 10)

- Synthetic data generator script complete
- Generated 300 documents, validated, reviewed for realism
- At least one document per PII type verified manually
- Dataset export tool tested with at least 10 finalized runs
- Exported JSONL verified by parsing each line and checking BIO label validity against Rampart's label space

### Phase 3: Demo + Polish (Weeks 11–12)

- Demo fixture document created and tested end-to-end
- Manual test script followed by a team member who did not write the code
- All edge cases verified and documented
- Type-checking and tests passing on CI
- Documentation updated
- Sidebar link verified end-to-end
- Final review: are the acceptance criteria met?

### Acceptance Criteria

The following must be true for M3 sign-off:

1. A user can upload a `.docx` file, the system extracts its text, and the document status becomes `ready`.
2. A user can create a redaction run on the extracted text, detect PII, review spans, and finalize.
3. `GET /api/redaction-runs/:runId/audit` returns a complete audit report in JSON format with all required fields.
4. The HTML and Markdown audit exports render correctly in browser and text viewer respectively.
5. The synthetic data generator produces at least 200 valid, validated JSONL documents across 7+ types.
6. The dataset export tool produces valid JSONL from at least one finalized, reviewed run.
7. The demo fixture can be run end-to-end without errors.
8. All edge cases in the edge case table have been tested and pass.
9. Type-checking and tests pass for all three affected packages.
10. `docs/current-product-scope.md` shows Redaction as implemented.

## Metrics

| Metric | Target | How to measure |
|--------|--------|----------------|
| DOCX extraction success rate | > 99% of valid DOCX files | Count extraction failures vs total uploads |
| DOCX extraction latency (p95) | < 5s for 20-page doc | Server-side timing |
| Audit report generation latency (p95) | < 2s | Server-side timing |
| Synthetic data generation speed | < 5 min for 500 docs | Script execution time |
| Synthetic data validation pass rate | 100% | All generated documents must pass validation |
| Demo end-to-end time | < 5 min (manual) | Stopwatch |
| Type-check zero-errors | 100% | CI pipeline |
| Test pass rate | 100% | CI pipeline (`pnpm test`) |
| Synthetic data documents | ≥ 200 | Generated manifest count |
| PII types covered | ≥ 10 | Manifest category coverage |
| Document types covered | ≥ 7 | Manifest document type list |
| Dataset export tool runs without error | 100% | Test with at least 10 runs |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Mammoth produces poor extraction** from complex legal DOCX (tables, headers, footnotes) | Medium | Medium | Test with 10+ real legal DOCX files before committing. Have fallback (`docx4js`) identified. For tables specifically: verify text reads left-to-right, top-to-bottom per mammoth's documented behaviour. |
| **Object storage not wired** for text_object_key path | High | High | Verify before Week 9. If not wired, implement upload-to-filesystem with same path structure as interim. |
| **Synthetic data unrealistic** — fails the "looks like a real legal document" test | Medium | High | Have a legal professional review 10 sample documents before generating the full set. Iterate on templates. |
| **Rampart model memory on 4vCPU/8GB server** during synthetic data generation | Low (generation happens offline) | Low | Generation runs on dev machine, not server. Rampart runs in-process at ~50-100 MB steady state. |
| **Audit report HTML export** has poor rendering for large span sets | Low | Medium | Test with 200-span run. Limit HTML page size by paginating audit log entries if needed. |
| **Dataset export tool produces sparse output** — few finalized runs with full review | Medium | Medium | Seed with synthetic data initially (from the generator). Real data grows over time. The tool itself should work correctly even with 1 run. |
| **Sidebar link** (activated in Phase 2) resolves to an empty or broken state | Low | Medium | Verify the route end-to-end during Week 11 polish. Use the matter-level document list as entry point. |
| **PDF uploads need clear error handling** — users will try uploading PDFs | High | Low | Block at upload with clear error message. Document in API docs. |

## Open Questions

1. **Should mammoth be replaced with a Python-based DOCX extractor** (python-docx)? This would keep text extraction closer to detection logic if Python is needed for fine-tuning anyway. *Decision: stay with mammoth for Phase 3. The Node.js API already handles uploads. No Python service runs in production. Python is only used offline for fine-tuning.*

2. **How should the synthetic data generator be validated by a legal professional?** We need a process for at least one qualified reviewer to spot-check synthetic documents. *Approach: generate 300, randomly sample 30 across all document types, send as PDF for review. Iterate on templates.*

3. **Should the synthetic data include organisation names as PII?** Rampart does not label `organisation_name` natively. If firms want to redact organisation names (e.g., competitor names in a commercial dispute), this needs a custom label and fine-tuning. *Deferred: for Phase 3, organisation names are marked but not included in the custom label space. Add `organisation_name` as a custom label post-MVP if firms require it.*

4. **What is the checkpoint versioning strategy for fine-tuned models?** Simple: store checkpoints in `op_artifacts/redact-checkpoints/ormont_legal_v1/YYYY-MM-DD/` with a metadata JSON. For Phase 3, a `checkpoint_versions` table is optional — document the path first, implement the table when the first fine-tune happens.

5. **Should the audit report include the full extracted text?** No — the report includes span excerpts but not the full text. Full text is accessible via the original document reference. Including it would make the audit artifact very large and duplicate storage.

6. **What is the right role taxonomy for `ormont_legal_v2`?** The roadmap proposes `person_party` / `person_professional` / `person_protected`, but the boundaries need legal review: is a witness a party or its own class? Do McKenzie friends, litigation friends, and interpreters count as professionals? Does `person_protected` need to distinguish statutory anonymity (contempt risk) from discretionary anonymity orders? *Approach: validate the taxonomy with the same legal professional who reviews the synthetic data samples (Open Question 2), before v2 data generation begins. The v1 role metadata (`info.roles`) should use fine-grained role names (judge, counsel, solicitor, claimant, defendant, witness, expert, child) so the v2 taxonomy can be decided later by grouping, not re-annotation.*

7. **How do we handle redaction of text inside DOCX tables specifically?** Mammoth extracts table cells as text separated by newlines, preserving row and cell order. Rampart detects PII across all text regardless of original layout. *Acceptable for Phase 3 — detecting PII in table text at the right granularity. Position-aware redaction (e.g., overlay redaction boxes over original content) is deferred to a future phase (PDF handling).*
