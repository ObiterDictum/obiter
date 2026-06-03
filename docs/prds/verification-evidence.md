# Verification Evidence PRD

## Summary

Verification Evidence is Ormont's shared trace and artifact model for inspectable legal outputs. It records how a query, draft, research answer, benchmark case, or Pi agent run moved from input to evidence to output.

[Bench](bench.md) measures quality across many cases. Verification Evidence explains a single result. Together they make Ormont reviewable by lawyers, builders, and university partners.

See the detailed implementation spec at [docs/specs/verification-evidence.md](../specs/verification-evidence.md).

## Problem

A legal answer is not verifiable because it has citations. It is verifiable only when a reviewer can inspect the exact evidence behind each material claim and see what the system checked, rejected, or left unresolved.

Without a shared evidence package, each module will invent a different trace format. Search will show ranked results, Verify will show findings, Research will show citations, Bench will show scores, and Pi will show tool traces. That fragmentation makes academic review weak and makes product debugging harder.

## Product Principles

- Evidence first, prose second.
- Exact source locations matter more than broad source references.
- Retrieved evidence and used evidence are different states.
- Unchecked claims must be visible.
- Weak support is not support.
- Exports must be bounded and safe.
- Evidence packages must serve UI inspection and external review.

## Goals

- Define one evidence package model shared by Search, Verify, Research, Bench, and Pi.
- Link generated claims and verification findings to exact evidence units.
- Distinguish retrieved, shortlisted, used, rejected, unresolved, and unchecked evidence.
- Preserve enough trace metadata to debug system behavior.
- Export bounded artifacts for university review.
- Avoid secrets, raw private matter text, embeddings, sensitive stack traces, and unapproved raw prompts.

## Non-Goals

- Complete legal correctness.
- A full audit log replacement.
- Raw prompt or raw document archival.
- Exposing all internal logs to reviewers.
- Full Research or Pi dependency for the first Search and Verify evidence packages (neither Research nor Pi is required for the first evidence package release).

## Users

### Lawyer User

Needs to inspect the evidence behind a claim before relying on an output.

### Academic Reviewer

Needs to evaluate whether Ormont's output is grounded in evidence.

### Internal Builder

Needs to debug failures in query planning, retrieval, ranking, generation, and verification.

### Benchmark Reviewer

Needs the same evidence the system used when scoring benchmark cases.

## Core Use Cases

1. A Search result shows why a case appeared and which paragraph matched.
2. A Verify finding shows the cited text, source text, mismatch reason, and confidence.
3. A Research answer maps each claim to source paragraphs and Verify findings.
4. A Bench case links to the evidence package used for scoring.
5. A Pi agent run shows which step retrieved or used each evidence unit.
6. A university reviewer exports bounded evidence packages for sampled cases.

## Scope

### First Release Scope

- evidence package schema
- evidence unit refs
- Search package type
- Verify package type
- claim-to-evidence map shape
- JSON export
- safe trace rules

### Later Scope

- Research package type
- Pi package type
- reviewer annotations
- evidence drawer UI
- human-readable export
- package signing or checksum

## Evidence Package Model

Required fields:

- `package_id`
- `package_type`
- `schema_version`
- `parent_run_type`
- `parent_run_id`
- `system_version`
- `created_at`
- `input_summary`
- `normalized_task`
- `trace_refs`
- `retrieved_evidence_refs`
- `used_evidence_refs`
- `output_refs`
- `verification_refs`
- `status`
- `limitations`

Package types:

- `search`
- `verify`
- `research`
- `agent`
- `benchmark`

Statuses:

- `complete`
- `partial`
- `manual_review_required`
- `failed`
- `export_redacted`

## Evidence Unit Model

Evidence units represent exact inspectable source locations.

Required fields:

- `evidence_id`
- `source_id`
- `source_type`
- `source_title`
- `display_citation`
- `source_url`
- `provider`
- `licence`
- `location_type`
- `location_ref`
- `version_ref`
- `excerpt_ref`
- `match_reason`
- `retrieval_rank`
- `retrieval_score`

Location types:

- `judgment_paragraph`
- `legislation_provision`
- `schedule_item`
- `treaty_article`
- `decision_paragraph`
- `quote_span`
- `citation_candidate`

Excerpt refs should point to bounded excerpts. Full source documents should not be embedded by default.

## Evidence State Model

Evidence refs should carry a state:

- `retrieved`
- `shortlisted`
- `used`
- `rejected`
- `unresolved`
- `unchecked`

Rejection reasons:

- `low_rank`
- `wrong_source`
- `wrong_paragraph`
- `ambiguous`
- `licence_restricted`
- `outside_scope`
- `contradictory`
- `duplicate`

## Claim-To-Evidence Model

Each material generated legal claim should include:

- `claim_id`
- `claim_summary`
- `output_location`
- `shown_citation`
- `support_status`
- `supporting_evidence_ids`
- `contrary_evidence_ids`
- `verification_finding_ids`
- `reviewer_note_refs`

Support statuses:

- `supported`
- `weak_support`
- `contradicted`
- `unsupported`
- `not_checked`
- `manual_review_required`

Rules:

- `not_checked` must never be rendered as support.
- `weak_support` must be visible to the user.
- `supported` requires at least one used evidence id.
- `contradicted` should carry contrary evidence where available.

## Trace Model

Trace entries are compact operational records.

Required fields:

- `trace_id`
- `package_id`
- `operation`
- `operation_version`
- `input_shape`
- `normalized_parameters`
- `output_shape`
- `status`
- `latency_ms`
- `error_category`
- `evidence_ids`

Examples:

- citation parser call
- search plan validation
- legal search execution
- reranking
- quote comparison
- Verify classification
- Pi tool call

Trace entries must not include raw private matter text or secrets.

## Product Workflows

### Search Workflow

1. User submits query.
2. Search normalizes query and executes retrieval.
3. Search emits evidence units for ranked hits.
4. Evidence package records query, normalized plan, ranks, scores, and match reasons.
5. UI can show why each result appeared.

### Verify Workflow

1. User verifies a draft.
2. Verify extracts citations and quotes.
3. Verify resolves authorities and compares quote spans.
4. Evidence package records draft refs, source refs, findings, and uncertainty.
5. UI can show source and draft side by side.

### Research Workflow

1. Research consumes Search evidence.
2. Model generates a source-bound answer.
3. Claims are mapped to evidence units.
4. Verify checks generated claims.
5. Evidence package records support status per claim.

### Pi Workflow

1. Agent executes steps.
2. Each step records evidence refs and tool-call traces.
3. Final output links claims to evidence.
4. Handoff includes evidence inspected and unresolved issues.

## UI Requirements

### Evidence Drawer

Displays:

- source title
- citation
- exact location
- bounded excerpt
- match reason
- evidence state
- support status
- ambiguity or limitation notes

### Claim Inspector

Displays:

- claim summary
- shown citation
- support status
- supporting and contrary evidence
- Verify findings
- reviewer notes

### Trace Inspector

Displays:

- operation timeline
- normalized parameters
- status
- latency
- error category
- evidence refs

Trace Inspector can be internal-only at first.

## Export Requirements

JSON export must include:

- package metadata
- evidence units
- claim map where present
- trace summaries
- output refs
- limitations
- redaction notice if content was removed

Exports must support sampled university review bundles. Human-readable exports can be derived later.

## Functional Requirements

- Search must produce evidence units for result hits and snippets.
- Verify must produce evidence packages for findings.
- Research must produce claim-to-evidence maps before answers are marked reliable.
- Pi must attach evidence refs to material steps.
- Bench must link scored items to evidence packages.
- Evidence packages must be retrievable by id.
- Evidence packages must be exportable as JSON.
- Evidence schemas must be versioned in shared contracts when implementation begins.

## Non-Functional Requirements

- Packages should be compact and bounded.
- Package creation should not materially slow normal Search result rendering.
- Evidence refs should be stable across rerenders and exports.
- Large source lists should be paginated or virtualized in UI.
- Unknown legal-critical states must fail visibly.

## Security And Compliance

- Do not store secrets, auth tokens, private keys, embeddings, private screenshots, or sensitive stack traces.
- Do not log raw private matter text by default.
- Do not store raw prompts containing private matter facts.
- Do not place client names, matter names, original filenames, or raw legal text in object keys.
- Public-source excerpts must respect licence and computational-analysis permissions.
- External exports must be scoped and may omit or summarize private matter refs.

## Dependencies

- [Search](search-quality.md) source ids and evidence ids.
- [Verify](verify.md) finding ids.
- [Bench](bench.md) run records.
- [Pi](pi-agent-framework.md) step and tool-call records for agent evidence packages.
- Shared contracts package (`packages/contracts`).
- Artifact storage for exported packages.

## Rollout

### Gate 1: Search And Verify Evidence

Deliver:

- schema draft
- Search evidence package
- Verify evidence package
- JSON export

Exit criteria:

- Search hits explain match reason and exact evidence location
- Verify findings link to source evidence

### Gate 2: Claim Mapping

Deliver:

- claim-to-evidence model
- Research package support
- post-generation Verify links

Exit criteria:

- generated legal claims show support status
- unchecked claims are explicit

### Gate 3: External Review

Deliver:

- export bundle support
- reviewer-safe package format
- sampled evidence packages for Bench

Exit criteria:

- academic reviewer can inspect selected cases without private matter access

## Metrics

- claims with evidence refs
- claims marked `not_checked`
- unsupported claim rate
- evidence package creation latency
- export success rate
- reviewer override rate
- retrieved-to-used evidence ratio

## Risks

- Evidence packages may become too verbose to inspect.
- Overly small excerpts may fail to support review.
- Product UI may blur the difference between retrieved and used evidence.
- Trace data may accidentally capture sensitive content if schemas are loose.
- Licence constraints may limit what can be exported.

## Open Questions

- Should evidence package ids be globally unique across modules or scoped by run type?
- What excerpt size is sufficient for review while remaining safe?
- Which package fields should be visible to ordinary users versus internal reviewers?
- Should exported packages include checksums in the first release?
