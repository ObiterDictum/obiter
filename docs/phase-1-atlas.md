# Phase 1 Atlas

## Purpose

Atlas is the public legal source layer. In Phase 1 it must do one job very well: resolve and retrieve authoritative legal sources fast enough to support research and verification.

## Phase 1 Outcome

By the end of Phase 1, Atlas should support:

- citation lookup
- keyword and metadata search
- paragraph-level retrieval for case law
- provision-level retrieval for legislation
- canonical authority records that other modules can trust

## Product Scope

### Core User Stories

1. As a user, I can search for a case by neutral citation.
2. As a user, I can search for a case or statute by name.
3. As a user, I can filter results by source type, date, and court or body.
4. As a user, I can open the exact paragraph or provision that supports a result.
5. As a verifier, I can resolve a citation into a canonical internal authority record.

### Phase 1 Source Scope

Start with a narrow but reliable corpus:

- UK Supreme Court judgments
- Court of Appeal judgments
- selected legislation needed for early workflows and the first demo
- enough metadata to support identifier resolution, source linking, and evidence display

Use official APIs and official-access pathways wherever possible.

### Non-Goals

- all common law jurisdictions
- editorial headnotes
- broad treatment classification
- encyclopedic secondary sources

## Recommended Tech Stack

### Ingestion And Services

- Node.js
- TypeScript
- `services/atlas-ingestor` for ingestion jobs
- `services/api` for retrieval APIs
- BullMQ for ingestion queues

### Storage And Search

- PostgreSQL for canonical source metadata
- Meilisearch for keyword and faceted search
- pgvector for embeddings where semantic search is useful
- object storage for raw source payloads

### Shared Packages

- `packages/legal-schema` for canonical legal document types
- `packages/citation-parser` for citation normalization
- `packages/search-client` for typed search access

## Why This Stack Fits

- Meilisearch gives fast lexical search and filters without overengineering
- PostgreSQL keeps identifiers and legal metadata consistent
- Node.js keeps ingestion, API, and parsing in one application language
- vector search can be added without making it the primary retrieval model

## Source Model

### Core Tables

`legal_sources`

- provider
- source_type
- licence_type
- source_url
- computational_analysis_allowed
- version_hash

`legal_documents`

- canonical_title
- document_type
- jurisdiction
- court_or_body
- date_published
- date_decided
- preferred_identifier
- source_document_uri
- neutral_citation

`judgment_paragraphs`

- document_id
- paragraph_number
- paragraph_label
- text
- normalized_text

`legislation_documents`

- title
- legislation_type
- year
- number
- current_version_date

`legislation_provisions`

- legislation_document_id
- provision_type
- provision_number
- parent_id
- heading
- text
- version_start_date
- version_end_date

## Ingestion Pipeline

### Phase 1 Pipeline Steps

1. fetch source payload from approved source
2. store raw artifact
3. normalize document metadata
4. extract paragraphs or provisions
5. parse identifiers
6. insert canonical records into PostgreSQL
7. push search records into Meilisearch
8. optionally create embeddings for semantic fallback

### Ingestion Rules

- preserve source provenance
- preserve source URLs and internal source identifiers
- keep parsing idempotent so reruns do not duplicate records
- do not bulk enrich restricted corpora before licence clearance

## Search Model

### Search Modes Required

- exact citation search
- party-name search
- title search
- keyword search
- provision lookup
- faceted result filtering

### Ranking Rules

Atlas should bias ranking toward:

1. exact identifier match
2. exact citation match
3. exact title or party-name match
4. keyword relevance
5. semantic similarity only as a supplemental signal

This is a legal retrieval system, not a generic semantic search app.

## API Surface

`GET /api/atlas/search`

- query
- source type
- court or body
- date range
- page

`GET /api/atlas/authorities/resolve`

- raw citation or identifier

`GET /api/atlas/documents/:documentId`

- canonical document record

`GET /api/atlas/documents/:documentId/paragraphs`

- paragraph slice for evidence display

`GET /api/atlas/legislation/:documentId/provisions/:provisionId`

- exact provision detail

## Performance Rules

- citation resolution should hit normalized lookup tables before broad search
- search responses should return summary payloads first, not full documents
- paragraph viewers should page or window large results
- ingestion should be resumable and restart-safe

## Failure Modes To Design For

- ambiguous citations
- malformed source payloads
- duplicate identifiers
- legislation version conflicts
- restricted or delayed source access

## Build Sequence

1. define canonical schema
2. implement citation normalization
3. ingest a small approved case law corpus
4. ingest a small legislation corpus
5. build authority resolution endpoint
6. build keyword and citation search endpoint
7. build paragraph and provision retrieval endpoints

## Acceptance Criteria

- a known authority can be resolved by citation
- users can search case law and legislation with filters
- search results can open exact supporting paragraphs or provisions
- Verify can consume Atlas authority resolution and evidence lookup reliably
