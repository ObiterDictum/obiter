# Verification Evidence Spec

Priority: `P2 university verification`

This document defines the evidence package Ormont should produce when it needs to make a result verifiable by an external reviewer. It applies to Search, Verify, Research, Bench, and Pi-backed agent runs.

## Purpose

A verification evidence package should make a result inspectable without asking the reviewer to trust the final answer alone.

It should show:

- the user-visible input
- the normalized task
- the retrieval or tool plan
- the public legal sources considered
- the evidence used and rejected
- the generated output or finding
- the checks applied after generation
- the system and configuration versions

## Package Types

### Search Evidence Package

Used for retrieval-only workflows.

Required fields:

- original query
- normalized search plan
- filters and jurisdiction
- citation or identifier candidates
- source ids returned
- paragraph or provision evidence ids
- rank, score, and match reason
- ambiguity flags
- provider and licence metadata

### Verify Evidence Package

Used for draft checking.

Required fields:

- verification run id
- draft location references
- extracted citations
- quote spans
- resolved source ids
- source evidence ids
- finding type
- severity
- confidence
- explanation for reviewer
- unresolved ambiguity or manual-review reason

### Research Evidence Package

Used for source-bound generated analysis.

Required fields:

- research run id
- normalized research question
- search plans executed
- evidence packs consumed by the model
- generated answer
- claim-to-evidence map
- post-generation Verify summary
- unsupported or weakly supported claim list

### Agent Evidence Package

Used for Pi-backed agent workflows.

Required fields:

- agent run id
- user goal
- agent version
- policy and tool configuration version
- step list
- tool calls
- tool outputs or bounded summaries
- evidence ids used by each step
- final output
- stop reason

## Claim-To-Evidence Map

Any generated legal answer should expose a claim-to-evidence map.

Each claim entry should include:

- claim id
- claim text or bounded summary
- answer location
- supporting evidence ids
- citation text shown to the user
- support status
- verification finding ids

Support statuses:

- `supported`
- `weak_support`
- `contradicted`
- `unsupported`
- `not_checked`
- `manual_review_required`

`not_checked` must be explicit. It must not be presented as support.

## Trace Rules

Trace data should be useful for review but bounded for safety.

Record:

- request id
- tool or operation name
- input shape and normalized parameters
- public source ids
- evidence ids
- status
- latency
- error category

Do not record:

- secrets
- raw private matter text
- raw prompts containing private matter facts
- embeddings
- full sensitive stack traces
- private screenshots
- object keys containing client names, matter names, or original filenames

## Export Format

The first export format should be JSON with stable field names. Human-readable reports can be generated from it later.

The package should be suitable for:

- local artifact storage
- benchmark run artifacts
- academic review
- product UI inspection
- future API access

## UI Requirements

Evidence views should allow a reviewer to:

- inspect the source behind a claim
- distinguish retrieved evidence from used evidence
- see unsupported and ambiguous items first
- open exact paragraph or provision references
- export the package without exposing private matter data

## Acceptance Criteria

- every generated legal answer can identify which evidence supported each cited claim
- every Verify finding can identify the source evidence used
- every benchmark result can link to an evidence package
- every agent run can show the steps and tools that led to the final output
- unsupported, unchecked, and manual-review states are visible
