# Phase 1 Verify

## Purpose

Verify is the trust layer. In Phase 1 it must catch the highest-risk legal drafting failures in stages: first fake authorities, bad citations, and inaccurate quotes, then later proposition support analysis.

## Phase 1 Outcome

By the end of Phase 1, a user should be able to upload or paste a draft and receive a structured verification report that explains what the system checked, what failed, what evidence was used, and what needs manual review.

The minimum acceptable first capability is:

- authority existence checking
- citation resolution
- quote mismatch detection

The full Verify target also includes proposition support, but that belongs to a later Verify milestone rather than the first implementation cut.

## Product Scope

### Delivery Stages

#### Verify Core

- authority existence checking
- citation resolution
- quote fidelity
- paragraph reference checks where feasible

#### Verify Advanced

- proposition extraction
- proposition-to-authority support analysis
- support classification and contradiction handling

### Core User Stories

1. As a user, I can run verification on a draft.
2. As a user, I can see whether each cited authority exists.
3. As a user, I can see whether quoted text matches the source.
4. As a user, I can export the verification findings as a review artifact.

### Non-Goals

- proving complete legal correctness
- replacing lawyer judgment
- resolving every ambiguous proposition automatically
- performing advanced appellate treatment analysis in Phase 1
- full proposition support analysis in the first implementation cut

## Recommended Tech Stack

### Core Services

- Node.js
- TypeScript
- `services/verify-worker`
- `services/api`
- BullMQ for verification jobs

### Shared Packages

- `packages/citation-parser`
- `packages/verification-core`
- `packages/legal-schema`

### Search Dependency

- Atlas APIs for authority resolution and evidence retrieval

## Why This Stack Fits

- verification logic benefits from shared deterministic TypeScript utilities
- queue workers keep long checks off the request path
- direct Atlas integration keeps verification grounded in the same canonical source graph the product uses elsewhere

## Verification Pipeline

1. ingest draft text
2. segment text into paragraphs or logical blocks
3. extract candidate citations
4. resolve citations against Atlas
5. extract quoted spans
6. match quotes to source paragraphs
7. score confidence and classify findings
8. generate structured verification report

## Check Types

### Authority Existence Check

For each citation:

- parse and normalize
- resolve against Atlas
- classify as resolved, ambiguous, or unresolved

### Quote Fidelity Check

For each quote:

- identify likely source
- compare quoted text to source text
- classify as exact, materially different, or unresolved

### Paragraph Reference Check

For each pinpoint reference:

- confirm that the referenced paragraph exists
- confirm that the cited paragraph is plausibly the one being invoked

## Data Model

`verification_runs`

- `id`
- `matter_id`
- `document_id`
- `status`
- `model_name`
- `prompt_version`
- `created_at`
- `completed_at`

`verification_findings`

- `id`
- `run_id`
- `finding_type`
- `severity`
- `status`
- `source_excerpt`
- `draft_excerpt`
- `evidence_json`
- `confidence`

`verification_claims`

- `id`
- `run_id`
- `claim_text`
- `citation_text`
- `resolved_document_id`
- `resolved_paragraph_ids`
- `support_status`

This table is part of the Verify Advanced expansion. It does not need to block the first implementation cut.

## Report Model

The report should group findings by category:

- unresolved or fake authority
- quote mismatch
- paragraph mismatch
- date-sensitive or stale authority concern
- manual review required

Each finding should include:

- the draft excerpt
- the cited authority
- the source evidence used
- the system classification
- a short explanation for a lawyer reviewer

## API Surface

`POST /api/documents/:documentId/verification-runs`

- start verification

`GET /api/verification-runs/:runId`

- run summary and status

`GET /api/verification-runs/:runId/findings`

- findings list with filters

`GET /api/verification-runs/:runId/report`

- assembled report payload

## UI Requirements

### Findings View

- filter by finding type and severity
- sort by unresolved, then lower-risk items in Verify Core
- side-by-side draft and source evidence view
- clear badges for resolved, warning, and review-required states

### Performance Rules

- findings tables should be virtualized if long
- source evidence should lazy-load when a finding opens
- repeated authority lookups should be cached within a run

## Failure Modes To Design For

- malformed citations
- quotations with ellipses or minor punctuation changes
- multiple possible source matches
- outdated law that cannot be determined from one source alone

The Verify Advanced stage must additionally handle propositions that require broader doctrinal context.

## Build Sequence

1. implement citation extraction and normalization
2. connect authority resolution to Atlas
3. implement quote matching
4. build findings UI and report export
5. calibrate severity and confidence labels using fixtures

## Verify Advanced Milestone

After Verify Core is stable, add:

1. proposition extraction
2. proposition-to-source comparison
3. support-status classification
4. UI support for unsupported, contradicted, and weak-support findings

## Acceptance Criteria

- the system can detect a fake or unresolved authority
- the system can detect a materially bad quote
- the user can inspect evidence for every finding
- the user can export a verification report

Verify is strategically complete only when proposition support has also been added in the Verify Advanced stage.
