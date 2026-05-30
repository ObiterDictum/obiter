# Phase 1 Search

## Purpose

Search is the public legal source layer. In Phase 1 it must do one job very well: resolve and retrieve authoritative legal sources fast enough to support research and verification.

The historical `atlas` file path, service names, index names, and some API paths are legacy implementation identifiers. New product, architecture, and review language should use Search unless it is referring to one of those existing identifiers directly.

## Phase 1 Outcome

By the end of Phase 1, Search should support:

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
- `services/atlas-ingestor` for ingestion jobs while that legacy service name remains in place
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

### Request Model

Search requests should support the following inputs before broad corpus expansion:

- `query`: required for normal search; optional only for explicit bounded browse endpoints
- `sourceType`: optional filter such as judgment, legislation document, or legislation provision
- `jurisdiction`: controlled jurisdiction filter
- `courtOrBody`: court, tribunal, parliament, government department, or other issuing body
- `dateFrom` / `dateTo`: decision, publication, or version date filters depending on source type
- `asAtDate`: required for legislation version-sensitive lookup once legislation is in scope
- `provider`: optional source-provider filter for diagnostics and controlled corpus views
- `page` or `cursor` plus `limit`: required before any result set can grow without bounds

The API should reject unsupported broad searches rather than translating them into unbounded provider calls.

### Result Model

Search results should be discriminated by source type and should share a stable common envelope:

- canonical document id
- source type
- title or canonical title
- jurisdiction
- court or issuing body
- primary citation or preferred identifier
- relevant date and, for legislation, applicable version date range
- source URL and provider
- licence and computational-analysis permission metadata where available
- match reason such as exact citation, title match, paragraph match, or provision match
- snippets or exact evidence references, not full document payloads

Judgment results should point to judgment paragraphs. Legislation results should point to provisions, headings, schedules, or versioned document records. Search should return the legal source as the primary result, not detached paragraphs or provisions with no parent document context.

### Case Law Search Rules

Case law search must support:

- exact neutral citation lookup with formatting normalization
- provider document id or slug lookup
- case title and party-name lookup
- keyword lookup over judgment metadata
- keyword lookup over stored or hydrated judgment paragraph text
- court, jurisdiction, source type, and decision-date filters
- paragraph snippets that explain body-text matches

Case law ranking should prefer:

1. exact provider or canonical document id
2. exact normalized neutral citation
3. exact case title or strongest party-name match
4. strong metadata keyword match
5. judgment paragraph body-text match
6. date ordering only as a tie-breaker within the same match class

If a citation is ambiguous or maps to multiple records, Search should return disambiguation candidates with enough metadata to choose safely. It should not silently pick a result without exposing the ambiguity.

### Legislation Search Rules

Legislation search must not be modeled as judgment search with different labels. It must support:

- statute or instrument title lookup
- short title and common abbreviation lookup where those aliases are explicitly stored
- year and number lookup, such as Act chapter or statutory instrument number
- provision lookup, including section, article, regulation, rule, schedule, paragraph, and sub-provision references
- keyword lookup over provision text, headings, and document metadata
- jurisdiction, issuing body, source type, date, and `asAtDate` filters
- in-force, repealed, prospective, and partially commenced states when those are available from the source
- amendment history and version ranges before presenting date-sensitive text as current law

Provision queries should normalize common legal forms, for example:

- `s 6 Human Rights Act 1998`
- `section 6 HRA 1998`
- `Human Rights Act 1998 section 6`
- `regulation 3 of the ... Regulations`
- `Schedule 2 paragraph 4`

Legislation ranking should prefer:

1. exact canonical legislation identifier
2. exact provision identifier within the requested or inferred legislation document
3. exact title, short title, or stored alias match
4. strong heading or provision-number match
5. provision text keyword match
6. document-level keyword match

Legislation results must make version context visible. If an `asAtDate` is supplied, results should resolve against the version effective on that date. If no `asAtDate` is supplied, current in-force text may be shown only when the source supports that claim; otherwise the response should expose uncertainty or require date context.

### Citation And Identifier Normalization

Search should use normalized lookup tables before broad keyword search for:

- neutral citations
- provider document ids and source URIs
- statute year/number identifiers
- provision identifiers
- title aliases and short titles
- citation graph references once available

Normalization must preserve the original user query for display and audit, but ranking and equality checks should use canonical forms. Ambiguous, malformed, or unsupported citations should fail visibly or return candidates; they must not degrade into misleading keyword-only success.

### AI And Tool Integration

Search is the retrieval substrate for AI-assisted Research, Verify, SDK clients, and MCP tools. Meilisearch is the primary fast lexical retrieval layer that makes model/tool querying practical. Search should make models better at finding and inspecting legal sources, but Search itself should not become an unsourced answer generator.

Model and tool callers should use Search through structured operations:

- resolve citation or identifier
- search legal sources
- fetch document metadata
- fetch paragraph or provision evidence
- fetch a bounded evidence pack for a query

The model-facing contract should prefer structured inputs over free-form prompt strings. A query-planning layer may use a model to turn a user question into a search plan, but the plan should be validated before execution. A search plan should be able to express:

- original user query
- detected citations
- detected legislation titles or aliases
- detected provision references
- source types to search
- jurisdiction and court or issuing body
- date range and `asAtDate`
- keywords and required terms
- requested evidence limit
- whether semantic retrieval is allowed as a supplemental step

The validated search plan must still run through deterministic retrieval surfaces. The preferred path is the Search API, because it can validate filters, apply auth and rate limits, attach provenance, enforce source permissions, shape evidence packs, and audit usage.

Direct Meilisearch access is allowed only for deliberately public legal-source retrieval surfaces using scoped search-only keys and public legal-source indexes. Model, SDK, and MCP callers must never receive Meilisearch admin keys, private matter indexes, database access, raw provider access, or access to indexes that contain private client material.

Model-facing responses should be evidence-first and compact:

- stable source ids and evidence ids
- source type and jurisdiction
- citation or preferred identifier
- title and court or issuing body
- paragraph or provision references
- bounded plain-text excerpts
- source URL and provider
- applicable version or `asAtDate` metadata
- match reason and rank
- ambiguity or uncertainty flags

AI answer generation should consume these evidence packs rather than raw full documents by default. If a model needs more context, it should explicitly request the next paragraph/provision window through Search. The API should keep those windows bounded so a broad research question cannot silently move an entire corpus into a model prompt.

AI safety and audit rules:

- Record retrieval trace metadata for AI-assisted flows: query, normalized plan, source ids, evidence ids, rank, model name, prompt or tool version, and request id.
- Do not log raw prompts containing private matter data in Search logs.
- Do not send private matter text to external models as part of Search. Matter-aware query planning belongs to Research or Verify, where redaction and audit controls can be applied.
- Public legal-source text may be sent to model contexts only according to licence and computational-analysis permissions.
- Generated answers must cite exact paragraphs or provisions and should be checked by Verify before being presented as reliable legal analysis.
- Model output must not create new canonical legal-source records. Only provider ingestion and validated source parsing can update the legal corpus.

### Ranking Rules

Search should bias ranking toward:

1. exact identifier match
2. exact citation match
3. exact title or party-name match
4. keyword relevance
5. semantic similarity only as a supplemental signal

This is a legal retrieval system, not a generic semantic search app.

Semantic or vector retrieval may help discovery, but it must not outrank exact identifiers, exact citations, known title aliases, or exact provision references. Any semantic result used in Research or Verify must still resolve to explicit paragraph or provision evidence.

## API Surface

`GET /api/search`

- query
- source type
- court or body
- date range
- as-at date for legislation once legislation is in scope
- page

Temporary legacy endpoint: `GET /api/atlas/authorities/resolve`

- raw citation or identifier

`GET /api/search/documents/:documentId`

- canonical document record

Temporary legacy endpoint: `GET /api/atlas/documents/:documentId/paragraphs`

- paragraph slice for evidence display

Temporary legacy endpoint: `GET /api/atlas/legislation/:documentId/provisions/:provisionId`

- exact provision detail

## Performance Rules

- citation resolution should hit normalized lookup tables before broad search
- search responses should return summary payloads first, not full documents
- paragraph viewers should page or window large results
- provision viewers should page or window large schedules and instruments
- snippets should be bounded and generated from indexed/stored text, not by moving full documents through result-list APIs
- public/API-key search should default to stored Ormont legal sources and must not trigger live provider fetches by default
- ingestion should be resumable and restart-safe

## Failure Modes To Design For

- ambiguous citations
- malformed source payloads
- duplicate identifiers
- legislation version conflicts
- missing or uncertain commencement data
- provision references that match multiple instruments or versions
- source-provider outages and rate limits
- restricted or delayed source access
- licence restrictions on computational analysis or redistribution

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
- case law body-text search returns judgment results with paragraph evidence
- statute and provision searches return version-aware legislation results with provision evidence
- ambiguous citations and provision references return candidates or visible uncertainty
- Verify can consume Search authority resolution and evidence lookup reliably
