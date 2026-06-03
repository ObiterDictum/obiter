# Search Quality PRD

## Summary

Search is Ormont's first trust substrate. Before [Verify](verify.md), [Research](research.md), [Bench](bench.md), or [Pi](pi-agent-framework.md) can be credible, Search must retrieve legal sources accurately, explain why results appeared, and cover the source families needed for serious legal work.

The current implementation is a good demo foundation, but it is still judgment-first and Find Case Law-shaped. It supports stored Meilisearch retrieval, PostgreSQL fallback, bounded snippets, Find Case Law live fallback and hydration, court/date filters, and a case detail view. It does not yet provide a full legal retrieval product, legislation search, stable evidence ids, source-family expansion, search quality benchmarks, or a UI that explains retrieval confidence and coverage.

See the detailed implementation spec at [docs/specs/search/](../specs/search/).

## Current Implementation Review

### What Exists

- `POST /api/search/fetch` searches stored legal authorities first, then PostgreSQL source storage, then optionally Find Case Law foreground results.
- `GET /api/search/documents/:documentId` returns stored or live-hydrated judgment documents.
- Meilisearch indexes `id`, `title`, `neutralCitation`, `court`, `jurisdiction`, and `paragraphs.text`.
- PostgreSQL `legal_source_documents` stores summary JSON, document JSON, provider metadata, and a generated full-text search vector that includes paragraph text.
- Search result payloads now return bounded `snippets` instead of full paragraph arrays.
- The UI supports debounced search, recent searches, court/date filters, stored-only court browse, result snippets, and a case detail page with search within case.
- Find Case Law integration can fetch Atom results, hydrate judgment HTML, parse paragraphs, store provider metadata, and index hydrated cases.

### Main Gaps

- Search schema only supports `sourceType: judgment`.
- API request shape has no source type, legal domain, source family, provider, topic, legislation version, or `asAtDate`.
- Ranking is Meilisearch default ranking plus a simple exact-match boost for id, neutral citation, and title.
- Exact legal lookup is not separated from broad keyword search.
- Snippets do not expose evidence ids, match reasons, source confidence, or rejected/ambiguous source state.
- Live provider behavior is useful for demos but not a stable external API model.
- Stored search failures and timeouts are intentionally swallowed, which preserves UX but hides diagnostics.
- The UI is case-law-specific and does not yet support legislation, provisions, instruments, multiple source families, or query diagnostics.
- Public URLs are not yet human-readable, source-type-specific, or citation-first.
- The ingestor is still sample-oriented; there is no full corpus ingestion, refresh, or source coverage dashboard.
- There is no Search benchmark harness yet.

## Problem

Legal search quality depends on exactness, provenance, and source coverage. Generic keyword search is not enough. Users must be able to find a known authority, inspect source evidence, search across legal text, filter by legally meaningful dimensions, and understand whether results came from stored Ormont sources or live provider fallback.

If Search remains weak, downstream systems will amplify the weakness:

- Verify will miss real authorities or resolve ambiguous citations poorly.
- Research will produce answers from incomplete evidence.
- Bench will measure retrieval noise rather than legal capability.
- Pi agents will automate unreliable source discovery.

## Product Principles

- Exact legal identifiers outrank semantic or body-text similarity.
- Search returns legal sources with evidence refs, not detached text fragments.
- Stored Ormont sources are the reliable substrate; live providers are acquisition paths.
- Provider behavior must not leak into stable public API contracts.
- Unsupported, ambiguous, unavailable, and unindexed states must be visible.
- Legislation needs version and provision logic; it cannot be treated as case-law text.
- UI should help users understand coverage, filters, and why a result matched.

## Goals

- Make judgment search accurate for citation, title, party-name, body-text, and paragraph queries.
- Add Search evidence metadata: source ids, evidence ids, match reasons, ranks, scores, and retrieval path.
- Build a benchmark-backed quality loop for Search changes.
- Expand Search beyond judgments, starting with UK legislation.
- Prepare stable legal-source API contracts for SDK, MCP, Research, Verify, Bench, and Pi.
- Improve UI and UX for source inspection, filtering, result confidence, and multi-source search.

## Non-Goals

- Do not build Research answer generation in this work.
- Do not implement Verify proposition support as part of Search.
- Do not expose live provider fallback as a default public API behavior.
- Do not bulk-ingest sources where licence or computational-analysis rights are unclear.
- Do not add vector search before exact and lexical retrieval are measured and stable.
- Do not silently train on private matter data.

## Users

### Lawyer Or Researcher

Needs to find known authorities quickly, search legal text, inspect exact paragraphs or provisions, and trust source provenance.

### Academic Reviewer

Needs to inspect retrieval methodology, source coverage, ranking rules, and benchmark results.

### Builder

Needs diagnostics that explain whether failures came from parsing, indexing, ranking, provider fallback, or UI state.

### API Or Tool Consumer

Needs stable source and evidence ids, predictable errors, rate limits, and contract-first retrieval responses.

## Core Use Cases

1. Find a known case by neutral citation.
2. Find a case by party names or title alias.
3. Search body text across hydrated judgments.
4. Open exact matching paragraphs from a result card.
5. Open a case through a canonical URL such as `/case/2024-uksc-3` or `/case/potanina-v-potanin-2024-uksc-3`.
6. Search legislation by title, year, chapter, section, schedule, or provision text.
7. Open legislation through a canonical URL such as `/legislation/unfair-contract-terms-act-1977` or `/legislation/ukpga-1977-50`.
8. Search by source family, jurisdiction, court/body, date, legal domain, and version context.
9. Identify when a query is ambiguous or no authoritative source is indexed.
10. Export or inspect retrieval evidence for a benchmark or university review.

## Scope

### First Release Scope

- judgment search quality improvements
- exact citation and document-id resolution path
- richer ranking and match reasons
- evidence ids for snippets and paragraphs
- Search benchmark gate
- UI result diagnostics and better filter states

### Expansion Scope

- legislation source model
- legislation.gov.uk provider adapter
- provision-level indexing and retrieval
- source family filters
- coverage dashboard
- stable `/api/v1/legal/*` routes
- MCP and SDK readiness

### Later Scope

- semantic retrieval as a supplemental signal
- international-law source families
- treatment and citation graph search
- matter-aware search through approved privacy boundaries
- public developer portal

## Search Architecture Requirements

### Source Model

Search must support a discriminated legal source model:

- `judgment`
- `legislation_document`
- `legislation_provision`
- `international_instrument`
- `international_decision`
- `guidance`
- `other`

Judgments should expose paragraph evidence. Legislation should expose document, provision, schedule, version, and commencement evidence. International sources should expose articles, rules, annexes, paragraphs, decisions, or source-specific evidence units.

### Query Classification

Before retrieval, Search should classify the query as one or more:

- exact neutral citation
- provider document id
- case title or party names
- statute title
- legislation citation
- provision reference
- general keyword query
- phrase query
- filter-only browse
- ambiguous or malformed query

Classification must preserve the original query and produce normalized forms for lookup.

### Retrieval Path

The preferred retrieval order:

1. exact id and citation lookup
2. title, alias, party-name, and legislation title lookup
3. structured provision or paragraph lookup
4. lexical keyword search over stored source metadata and text
5. supplemental semantic search after exact/lexical baselines are stable
6. live provider acquisition only when explicitly allowed

Each result should record retrieval path and match reason.

### Ranking

Ranking must prioritize:

1. exact document id
2. exact neutral citation or legislation citation
3. exact provision reference
4. exact title or short title
5. party-name/title alias match
6. paragraph or provision phrase match
7. all-term body match
8. any-term body match
9. semantic similarity
10. recency as a tie-breaker only where legally appropriate

Search must not let semantic similarity outrank exact identifiers.

## Corpus And Provider Expansion

### Judgments

Current source:

- Find Case Law through The National Archives.

Needed improvements:

- full supported corpus ingestion rather than search-triggered hydration only
- ingestion status by court and date range
- refresh by provider content hash
- parser confidence metrics
- source coverage and skipped-document reporting
- provider outage and rate-limit diagnostics

### Legislation

Initial source:

- `legislation.gov.uk`.

Required capabilities:

- Acts, statutory instruments, schedules, and provisions
- title, short title, year, chapter, SI number, and provision lookup
- provision text indexing
- version and `asAtDate` support
- commencement and amendment metadata where available
- current and historical version distinction
- source URL and licence metadata

Legislation must be modeled separately from judgments. A section, schedule, or regulation can be an evidence unit, but the parent legal source must remain visible.

### International And Specialist Sources

Candidate later sources:

- UK treaties and command papers where licence permits
- BAILII collections where terms permit
- EUR-Lex for retained or comparative EU materials where relevant
- HUDOC for ECHR materials
- UN treaty bodies and international court decisions
- ICRC IHL materials where licence permits

Every source family needs a provider assessment before ingestion:

- licence
- computational-analysis permission
- source structure
- update cadence
- citation format
- evidence granularity
- parser risk

## API Requirements

### Current App API Improvements

`POST /api/search/fetch` should evolve to include:

- source type filter
- source family filter
- jurisdiction
- court or issuing body
- legal domain
- date range
- `asAtDate` for legislation
- result limit and cursor
- search mode
- evidence metadata toggle

### Stable Legal Source API

Future routes:

- `GET /api/v1/legal/search`
- `GET /api/v1/legal/documents/:documentId`
- `GET /api/v1/legal/documents/:documentId/evidence`
- `GET /api/v1/legal/citations/resolve`
- `GET /api/v1/legal/legislation/:documentId/provisions/:provisionId`

Stable API behavior:

- stored Ormont sources by default
- no live provider fallback unless explicit
- contract-first schemas in `packages/contracts`
- stable errors for validation, unavailable storage, rate limits, not found, and ambiguous queries
- source provenance and licence metadata on results

## Public URL Requirements

Public source URLs should be readable, stable, and source-type-specific.

Target routes:

- `/case/:caseSlug`
- `/case/:caseSlug/paragraph/:paragraphNumber`
- `/legislation/:lawSlug`
- `/legislation/:lawSlug/:provisionSlug`

Case slugs should be derived from canonical citation and title data:

- neutral citation
- title or party names
- decision year

Legislation slugs should be derived from canonical title and official identifiers:

- short title
- chapter or SI number
- official legislation.gov.uk identifier

Rules:

- Internal document ids remain valid storage keys, but public links should use canonical slugs.
- Slugs must resolve to a stable source id server-side.
- Old `/cases/:caseId` routes should redirect to canonical `/case/:caseSlug` when the source is known.
- Ambiguous slugs must return candidates rather than silently choosing the wrong source.
- Canonical URLs should be included in Search result payloads so the UI does not reconstruct them ad hoc.
- Official source URLs must remain visible on detail pages.

## Evidence Requirements

Each result should include:

- source id
- source type
- display citation
- source URL
- provider
- licence status
- evidence ids
- evidence type
- paragraph or provision refs
- match reason
- retrieval path
- rank
- score
- ambiguity flags

Snippets should be bounded and tied to evidence ids. Result payloads must not return full documents.

## UI And UX Requirements

### Search Screen

Improve the current screen with:

- source-type tabs or segmented control
- source family and jurisdiction filters
- court/body filter
- date and `asAtDate` controls
- active filter chips
- result count and source coverage state
- stored/live/acquisition state labels
- keyboard navigation across results
- clear empty states for not indexed, no match, provider unavailable, and ambiguous query

### Result Cards

Result cards should show:

- title
- citation or identifier
- source type
- court/body
- date or version
- match reason
- snippets with paragraph/provision labels
- source provenance
- evidence count
- warning flags for ambiguity, missing full text, or provider-only result

### Source Detail

The current case page should become a generic legal source detail view:

- judgment paragraph viewer
- legislation provision viewer
- source metadata panel
- search within source
- jump to paragraph/provision
- copy citation and source link
- open official source
- show indexed/hydrated status
- show canonical Ormont URL
- redirect internal-id URLs to canonical citation or legislation URLs

### Diagnostics For Review

Internal or reviewer mode should show:

- normalized query
- query class
- retrieval path
- filters applied
- rank and score
- provider calls made
- stored-search timeout or fallback state

## Benchmark Requirements

Search quality must be benchmarked before major ranking or corpus changes are treated as complete. The canonical benchmark framework is defined in the [Bench PRD](bench.md); the sections below define the Search-specific cases and metrics that feed into it.

Initial benchmark cases:

- exact citation lookup
- malformed citation
- ambiguous citation
- case title
- party names
- provider document id
- body-text phrase
- no-answer query
- court-filter browse
- date-filtered query

Legislation benchmark cases:

- Act title
- short title
- year and chapter
- SI number
- section reference
- schedule reference
- `asAtDate` version query
- provision text phrase

Metrics:

- top-1 exact source success
- top-3 exact source success
- evidence unit recall
- no-answer precision
- ambiguity surfaced
- provider fallback rate
- stored search latency
- snippet usefulness reviewer score

## Functional Requirements

- Search must separate exact lookup from broad search.
- Search must return stable evidence ids for snippets.
- Search must expose match reasons and retrieval path.
- Search must support judgment and legislation source models.
- Search must support cursor or bounded pagination before corpus expansion.
- Search must track provider ingestion and hydration status.
- Search must expose stable source provenance and licence metadata.
- Search must provide benchmark fixtures for every major search mode.

## Non-Functional Requirements

- Search result-list responses must stay lean.
- Search must avoid silent weakening when Meilisearch or PostgreSQL fallback is unavailable.
- Long ingestion and hydration must run outside the request path.
- Search must preserve auditability for model/tool-facing retrieval.
- UI must remain usable on desktop and mobile widths.
- Large source viewers must use windowing or paging.

## Security And Compliance

- Do not store private matter data in public legal-source indexes.
- Do not expose Meilisearch admin keys, database access, provider credentials, or private indexes to models, SDKs, or MCP tools.
- Do not log raw prompts containing private matter facts in Search.
- Respect source licence and computational-analysis permissions.
- Keep hosted data in the EU.
- Object keys must not contain client names, matter names, original filenames, or raw legal text.

## Dependencies

- [Bench](bench.md) — Search benchmark fixtures and quality gates for ranking and corpus changes.
- [Verification Evidence](verification-evidence.md) — Evidence id schema, evidence unit model, and evidence package export for Search result payloads.
- Shared contracts package (`packages/contracts`) — Type definitions for stable API routes and legal-source schemas.
- Provider licence assessments — Required before corpus expansion to new source families or jurisdictions.
- Infrastructure — Ingestion jobs, corpus refresh workers, and coverage reporting for stored-source reliability.

## Rollout

### Gate 1: Judgment Search Quality

Deliver:

- exact lookup path
- canonical `/case/:caseSlug` route and redirects from `/cases/:caseId`
- improved ranking labels
- evidence ids for snippets
- better result-card metadata
- Search benchmark fixtures

Exit criteria:

- exact citations and document ids rank first
- search results link to canonical case URLs
- body-text matches show evidence snippets
- no-answer and ambiguous states are explicit

### Gate 2: Corpus Reliability

Deliver:

- broader Find Case Law ingestion
- ingestion coverage report
- parser confidence and skipped-document reporting
- stored-source diagnostics

Exit criteria:

- Search no longer depends mainly on user-triggered hydration
- stored corpus coverage is visible

### Gate 3: Legislation Search

Deliver:

- legislation source schema
- legislation.gov.uk adapter
- canonical `/legislation/:lawSlug` route
- provision indexing
- `asAtDate` support
- legislation UI filters and detail view

Exit criteria:

- user can find an Act, SI, section, schedule, and provision text
- version-sensitive results expose date context

### Gate 4: Stable API And Tool Readiness

Deliver:

- `/api/v1/legal/*` routes
- shared contracts
- evidence metadata
- API-key scoped readiness
- MCP-safe retrieval operations

Exit criteria:

- tool callers can retrieve legal sources without provider internals or admin credentials

## Metrics

- Exact citation lookup success rate (top-1 and top-3).
- Body-text search recall at top-3 for phrase and keyword queries.
- Evidence-id coverage rate on result and snippet payloads.
- Stored search vs. provider-fallback ratio (target: >90% from stored).
- Corpus coverage by source family and jurisdiction.
- Citation parse success rate.
- No-answer precision (queries that should return nothing vs. false hits).
- Ambiguity surfaced rate (ambiguous queries where the UI explicitly shows the ambiguity).
- Legislation search success for title, reference, and provision queries (when legislation scope ships).
- Search result-list latency (p50, p95).
- Ingestion coverage report completeness (documents ingested vs. available per court).

## Risks

- Corpus expansion may be blocked or slowed by licence constraints.
- Ranking changes can improve keyword search while harming exact lookup.
- Legislation versioning is complex and must not be faked.
- Provider fallback can make demos look better than stored retrieval quality.
- UI can become overloaded if diagnostics are shown to all users.

## Open Questions

- Which legislation source subset should ship first: UK Public General Acts, SIs, or both?
- Should source coverage be visible publicly or only internally at first?
- What is the minimum Search benchmark size for university review?
- Should semantic retrieval wait until Bench proves exact and lexical baselines?
- Which specialist source family matters most after legislation?
