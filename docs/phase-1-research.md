# Phase 1 Research

## Purpose

Research is the controlled user-facing legal research experience built on top of Atlas and Verify. In Phase 1 it should answer questions with evidence, not just generate prose.

It should be framed as legal search with AI-assisted synthesis and summaries, not as a conversational legal assistant.

## Phase 1 Outcome

By the end of Phase 1, a user should be able to ask a legal research question, see the sources used, inspect supporting paragraphs or provisions, and receive an answer that has already been checked by Verify.

## Product Scope

### Core User Stories

1. As a user, I can ask a legal research question within a matter.
2. As a user, I can specify the relevant jurisdiction and date context.
3. As a user, I can see the source paragraphs and provisions used in the answer.
4. As a user, I can see when the answer has weak support or contradictory support.
5. As a user, I can export the answer as a reviewable memo or summary.

### Non-Goals

- general chat product behavior
- unbounded conversational memory
- unsourced freeform drafting
- autonomous research agent loops in Phase 1
- silent model learning from client matter data

## Recommended Tech Stack

### Frontend

- React
- TanStack Start
- TanStack Router
- TanStack Query
- TanStack Table for source and evidence tables
- TanStack Virtual for long source lists
- Electron for the desktop shell

### Backend

- Node.js
- TypeScript
- `services/api` for orchestration
- `services/worker` for retrieval or answer jobs if needed
- Atlas retrieval APIs
- Verify APIs for post-generation checking

## Why This Stack Fits

- the UI can stay fast with incremental loading and shared components
- TanStack Router and Query fit a data-heavy evidence-driven interface better than heavyweight page abstractions
- Electron and web can share the same research screens with minimal divergence

## User Flow

1. user opens a matter
2. user enters a question
3. user sets jurisdiction and optional "as at" date
4. system runs Atlas retrieval
5. system shows source candidates
6. system generates a source-bound answer
7. system runs Verify over the answer
8. system shows the answer with evidence and warnings
9. user exports a memo or summary

## Retrieval Model

Research should use layered retrieval:

1. exact citation and identifier resolution if the query contains one
2. keyword and metadata search over Atlas
3. semantic retrieval only as a supplement
4. reranking that rewards exact legal relevance and source quality

## Generation Rules

The answer generator should:

- cite the paragraphs or provisions it relies on
- avoid answering beyond retrieved support
- surface uncertainty explicitly
- show contrary or limiting sources where available
- route unsupported claims into verification warnings

The first implementation should rely on retrieval and evidence-grounded synthesis, not weight-changing fine-tuning from user matters.

## UI Requirements

### Research Screen

- question input
- jurisdiction selector
- date context input
- result answer panel
- source list panel
- evidence viewer
- verification summary panel

### Interaction Rules

- source list should remain visible while reading the answer
- clicking a citation in the answer should open the source evidence
- the user should be able to inspect why a conclusion was reached
- loading states should reveal retrieval progress, not just a spinner

## API Surface

`POST /api/research/runs`

- create a research run from a matter and question

`GET /api/research/runs/:runId`

- run summary, status, and answer

`GET /api/research/runs/:runId/sources`

- ranked supporting sources

`GET /api/research/runs/:runId/verification`

- post-generation verification summary

## Data Model

`research_runs`

- `id`
- `matter_id`
- `question`
- `jurisdiction`
- `as_at_date`
- `status`
- `answer_markdown`
- `created_at`

`research_run_sources`

- `id`
- `run_id`
- `document_id`
- `paragraph_id`
- `provision_id`
- `rank`
- `usage_type`

## Performance Rules

- retrieval should stream or progressively reveal source candidates
- answer rendering should not wait on loading full source text for every hit
- source viewers should fetch paragraph slices, not whole corpora
- expensive reranking should run in workers where needed

## Failure Modes To Design For

- weak retrieval for broad questions
- contradictory authorities
- stale legislative position for date-sensitive issues
- answer text drifting beyond source support
- UI overload when too many sources are shown

## Build Sequence

1. build question form and run model
2. connect Atlas retrieval
3. render source list and evidence viewer
4. add source-bound answer generation
5. connect Verify post-generation checks
6. add export flow for memo and summary

## Acceptance Criteria

- a user can ask a legal question and get an answer with visible source support
- the answer links to exact paragraphs or provisions
- the answer shows verification warnings when support is weak
- the user can export the result as a reviewable artifact
