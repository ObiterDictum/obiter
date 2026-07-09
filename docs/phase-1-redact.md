# Phase 1 Redact

## Purpose

Redact is the privacy layer. In Phase 1 it needs to make legal documents safer to process by detecting sensitive content, letting a human review it, and exporting controlled outputs.

## Phase 1 Outcome

By the end of Phase 1, a user should be able to upload a legal document, run redaction detection, review the proposed spans, choose between pseudonymisation or hard redaction, and export both the result and an audit log.

Desktop-local redaction is the preferred sensitive path. Hosted redaction should also exist for web workflows, but it must be clearly surfaced as a hosted operation.

## Product Scope

### Core User Stories

1. As a user, I can upload a draft that contains personal or confidential data.
2. As a user, I can see detected sensitive spans before the system changes the output.
3. As a user, I can accept, reject, or edit the proposed redactions.
4. As a user, I can export a pseudonymised version for internal AI use.
5. As a user, I can export an irreversibly redacted version for external sharing.

### Non-Goals

- claiming compliance by default
- fully automated final redaction for high-risk legal outputs
- handling every file type in Phase 1
- replacing specialist publication review processes

## Recommended Tech Stack

### Application Layer

- Node.js
- TypeScript
- `services/api` for orchestration and review APIs
- `services/worker` for queue coordination

### Redaction Engine

- Python in `services/redact-worker`
- OpenAI Privacy Filter as the base detection model
- PDF and text extraction libraries appropriate to the chosen file formats
- desktop-local execution path for sensitive runs
- hosted execution path for web and metered usage

### UI

- React
- TanStack Start
- TanStack Query
- TanStack Table for review queues and audit tables
- Electron for local-first document handling where needed

## Why This Stack Fits

- the core product remains mostly TypeScript
- Python is isolated to the place where ML and document processing justify it
- Electron allows local file workflows without forcing a cloud-only path
- TanStack Query supports clear job state and review screen refresh logic
- the hosted path keeps the web app commercially usable without requiring local ML

## Input Scope

Phase 1 should support:

- plain text
- PDF where text can be extracted reliably
- optionally DOCX if extraction stays simple and stable

Do not broaden file support until the review workflow is strong.

## Redaction Modes

### Internal AI Minimisation

Use when the user wants to reduce sensitive data exposure while preserving analytical usefulness.

Behavior:

- pseudonymise names and selected sensitive entities
- preserve document structure where possible
- maintain reversible mapping inside the matter

### External Redaction

Use when the user wants a sharable output.

Behavior:

- replace approved spans irreversibly
- remove rather than merely conceal content in the exported output
- produce a reviewable log

## Execution Modes

### Desktop Local

Use for the preferred sensitive workflow.

- runs on the user's machine
- supports offline desktop redaction
- avoids sending document content to hosted ML infrastructure by default

### Hosted

Use for web workflows or users who choose hosted processing.

- runs through Obiter infrastructure
- may be metered commercially
- must be clearly labeled as hosted processing

## Data Model

`redaction_runs`

- `id`
- `matter_id`
- `document_id`
- `policy_id`
- `model_name`
- `model_version`
- `mode`
- `status`
- `created_at`
- `completed_at`

`redaction_spans`

- `id`
- `run_id`
- `label`
- `start_offset`
- `end_offset`
- `original_text_hash`
- `decision`
- `replacement_text`
- `confidence`
- `reviewed_by`
- `reviewed_at`

`redaction_maps`

- `id`
- `run_id`
- `map_type`
- `object_key`

## Pipeline

1. extract document text
2. split into stable reviewable segments
3. run Privacy Filter detection
4. run Obiter legal policy rules over the raw detections
5. persist suggested spans
6. show spans in review UI
7. apply reviewer decisions
8. generate redacted or pseudonymised output
9. generate audit log

## Policy Layer

The policy layer should sit above base PII detection. It should decide:

- which labels are shown to the reviewer
- which labels default to accept or review
- what replacement style is used
- which spans are allowed to remain for internal minimisation

Phase 1 should support policy labels such as:

- person
- address
- email
- phone
- account or reference number
- secret or credential
- client-specific identifier

## UI Requirements

### Review Screen

- document text viewer
- highlighted spans
- accept or reject controls per span
- bulk actions by label
- preview of output mode
- audit summary panel

### Performance Rules

- do not render entire long documents as one DOM block
- use virtualization for long span lists
- load text in chunks where needed
- keep redaction review state incremental and autosaved

## API Surface

`POST /api/documents/:documentId/redaction-runs`

- start a redaction run for a mode

`GET /api/redaction-runs/:runId`

- fetch run summary and status

`GET /api/redaction-runs/:runId/spans`

- fetch suggested spans

`POST /api/redaction-runs/:runId/spans/:spanId/decision`

- accept, reject, or edit a span

`POST /api/redaction-runs/:runId/finalize`

- generate final output and audit artifacts

## Failure Modes To Design For

- false positives that remove legal meaning
- false negatives on names or identifiers
- broken PDF extraction
- offsets drifting after user edits
- visually redacted but textually recoverable output

## Build Sequence

1. support text extraction for the first file types
2. integrate Privacy Filter worker
3. persist raw detections and review states
4. build review UI
5. implement pseudonymised output
6. implement irreversible redacted export
7. add audit report generation

## Acceptance Criteria

- a user can run redaction detection on an uploaded document
- the user can review and edit proposed spans
- the system can produce pseudonymised and redacted outputs
- the system supports a local desktop path and a hosted path
- every final output is accompanied by an audit record
