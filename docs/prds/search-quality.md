# Search Quality PRD

## Summary

Search is Ormont's first trust substrate. Before [Verify](verify.md), [Research](research.md), [Bench](bench.md), or [Pi](pi-agent-framework.md) can be credible, Search must retrieve legal sources accurately, expose why results appeared, and cover the source families needed for serious legal work.

The current implementation is a useful judgment-search foundation. It supports stored Meilisearch retrieval, PostgreSQL fallback, bounded snippets, Find Case Law live fallback and hydration, court/date filters, result keyboard flows, and case detail pages. It does not yet provide a full legal retrieval product, legislation search, stable evidence ids, measured ranking quality, corpus coverage reporting, or a UI that clearly distinguishes stored, live, ambiguous, and unavailable source states.

Detailed implementation guidance lives in [docs/specs/search/](../specs/search/). This PRD defines the product target and rollout gates.

## Current State

What exists:

- `POST /api/search/fetch` searches stored legal authorities first, then PostgreSQL source storage, then optional Find Case Law foreground results.
- `GET /api/search/documents/:documentId` returns stored or live-hydrated judgment documents.
- Meilisearch indexes `id`, `title`, `neutralCitation`, `court`, `jurisdiction`, and `paragraphs.text`.
- PostgreSQL `legal_source_documents` stores summary JSON, document JSON, provider metadata, and a generated full-text search vector that includes paragraph text.
- Search result payloads return bounded `snippets` instead of full paragraph arrays.
- Judgment result payloads expose evidence ids, match reason, retrieval path, retrieval rank, and retrieval score metadata.
- Search responses expose explicit outcome states for results, no match, queued hydration, and empty stored-source browse.
- Exact document-id and neutral-citation queries use a stored exact-lookup path before broad keyword search.
- Judgment Search hits include canonical Ormont URLs such as `/case/potanina-v-potanin-2024-uksc-3`, result opening uses them, and `/cases/:caseId` redirects to the canonical route when the document is known.
- Gate 1 judgment Search benchmark seed artifacts exist under `data/evals/search/`.
- Shared schemas now define future source types and source families, and Search requests model source type, source family, legal domain, provider, topic, `asAtDate`, and legislation version fields.
- The UI supports debounced search, recent searches, court/date filters, stored-only court browse, result snippets, keyboard navigation, and search within case detail pages.
- Find Case Law integration can fetch Atom results, hydrate judgment HTML, parse paragraphs, store provider metadata, and index hydrated cases.

Main gaps:

- Non-judgment source types are modeled but return explicit unsupported-source outcomes until source-specific retrieval exists.
- Ranking is still mostly Meilisearch default ranking plus simple exact-match boosts for id, neutral citation, and title.
- Exact lookup is separated for judgment document ids and neutral citations, but provision, title-alias, malformed-citation, and ambiguity-specific lookup paths are not complete.
- Search does not yet expose ambiguity or rejected-source state.
- Live provider behavior is useful for demos but is not a stable public API model.
- Stored search failures and timeouts are intentionally swallowed, which protects UX but hides diagnostics.
- The corpus path is still sample-oriented; there is no full ingestion, refresh, source coverage dashboard, or executable Search benchmark runner.

## Problem

Legal search quality depends on exactness, provenance, and source coverage. Generic keyword search is not enough. Users must be able to find a known authority, inspect exact evidence, search legal text, filter by legally meaningful dimensions, and understand whether results came from stored Ormont sources or live provider acquisition.

If Search remains weak, downstream systems amplify the weakness: Verify misses real authorities, Research answers from incomplete evidence, Bench measures retrieval noise, and Pi agents automate unreliable source discovery.

## Product Principles

- Exact legal identifiers outrank semantic or body-text similarity.
- Search returns legal sources with evidence refs, not detached text fragments.
- Stored Ormont sources are the reliable substrate; live providers are acquisition paths.
- Provider behavior must not leak into stable public API contracts.
- Unsupported, ambiguous, unavailable, and unindexed states must be visible.
- Legislation needs version and provision logic; it cannot be treated as case-law text.
- UI should help users understand coverage, filters, provenance, and why a result matched.

## Goals

- Make judgment search accurate for citation, title, party-name, body-text, and paragraph queries.
- Add Search evidence metadata aligned with [Verification Evidence](verification-evidence.md): `evidence_id`, `source_id`, `source_type`, `location_type`, `location_ref`, `excerpt_ref`, `match_reason`, `retrieval_rank`, and `retrieval_score`.
- Build a benchmark-backed quality loop for Search changes, aligned with [Bench](bench.md).
- Expand Search beyond judgments, starting with UK legislation once judgment quality and corpus reliability are stable.
- Prepare contract-first legal-source APIs for SDK, MCP, Research, Verify, Bench, and Pi without turning the app Search endpoint into the public API.
- Improve UI and UX for source inspection, filtering, result confidence, ambiguity, and multi-source search.

## Non-Goals

- Do not build Research answer generation in this work.
- Do not implement Verify proposition support as part of Search.
- Do not expose live provider fallback as default public API behavior.
- Do not bulk-ingest sources where licence or computational-analysis rights are unclear.
- Do not add vector search before exact and lexical retrieval are measured and stable.
- Do not silently train on private matter data.

## Users And Use Cases

Primary users:

- Lawyer or researcher: finds known authorities, searches legal text, inspects paragraphs or provisions, and checks provenance.
- Academic reviewer: inspects methodology, source coverage, ranking rules, benchmark results, and evidence packages.
- Builder: diagnoses parsing, indexing, ranking, provider fallback, and UI state.
- API or tool consumer: needs stable source ids, evidence ids, predictable errors, rate limits, and contract-first responses.

Core use cases:

1. Find a known case by neutral citation, party name, title alias, provider id, or body-text phrase.
2. Open exact matching paragraphs from a result card.
3. Open a case through a canonical Ormont URL such as `/case/potanina-v-potanin-2024-uksc-3`.
4. Search legislation by title, year, chapter, section, schedule, provision reference, or provision text.
5. Open legislation through a canonical Ormont URL such as `/legislation/unfair-contract-terms-act-1977` or `/legislation/ukpga-1977-50`.
6. Filter by source family, jurisdiction, court/body, date, legal domain, and version context.
7. Identify ambiguous, malformed, unsupported, unavailable, or unindexed queries.
8. Export or inspect retrieval evidence for a benchmark or university review.

## Scope

Gate 1 is judgment Search quality. It should build only the foundation needed to make the existing Search product trustworthy:

- exact citation and document-id resolution
- judgment ranking improvements and match reasons
- canonical case URLs
- evidence ids for judgment snippets and result payloads
- explicit unsupported-source responses for non-judgment source types
- clear ambiguity states
- result-card metadata and limited reviewer diagnostics
- executable Search benchmark runner and run records

Expansion begins after Gate 1 ranking and evidence behavior are benchmarked:

- broader Find Case Law ingestion and coverage reporting
- legislation source model and legislation.gov.uk adapter
- provision-level indexing and retrieval
- source-family filters
- stable `/api/v1/legal/*` routes
- SDK and MCP readiness

Later scope:

- semantic retrieval as a supplemental signal
- international-law source families
- treatment and citation graph search
- matter-aware search through approved privacy boundaries
- public developer portal

## Search Architecture

### Source Model

Search must grow toward a discriminated legal source model: `judgment`, `legislation_document`, `legislation_provision`, `international_instrument`, `international_decision`, `guidance`, and `other`.

Judgments expose paragraph evidence. Legislation exposes document, provision, schedule, version, and commencement evidence. International sources expose articles, rules, annexes, paragraphs, decisions, or source-specific evidence units. New source families require source-specific schemas, indexing, licence assessment, parser confidence, and benchmark fixtures; they must not be forced through the current judgment shape.

### Query Classification

Before retrieval, Search should classify the query as one or more: exact neutral citation, provider document id, case title or party names, statute title, legislation citation, provision reference, general keyword query, phrase query, filter-only browse, and ambiguous or malformed query.

Classification must preserve the original query for display and audit while producing normalized lookup forms.

### Retrieval And Ranking

The preferred retrieval order is:

1. exact id and citation lookup
2. title, alias, party-name, and legislation title lookup
3. structured provision or paragraph lookup
4. lexical keyword search over stored source metadata and text
5. supplemental semantic search after exact and lexical baselines are stable
6. live provider acquisition only when explicitly allowed

Ranking must prioritize exact document ids, exact citations, exact provision references, exact titles or stored aliases, party-name/title aliases, paragraph or provision phrase matches, all-term body matches, any-term body matches, semantic similarity once available, and recency only as a legally appropriate tie-breaker. Search must not let semantic similarity, recency, or broad keyword matches outrank exact identifiers.

Each result records retrieval path and match reason. Provider fallback is not a substitute for stored body search.

## Source Families

Judgments currently come from Find Case Law through The National Archives. Needed improvements are full supported corpus ingestion rather than search-triggered hydration only, ingestion status by court and date range, refresh by provider content hash, parser confidence metrics, source coverage reporting, skipped-document reporting, and provider outage/rate-limit diagnostics.

Legislation starts with `legislation.gov.uk`. It must support Acts, statutory instruments, schedules, provisions, title lookup, short-title lookup, year/chapter lookup, SI number lookup, provision text indexing, `asAtDate`, commencement/amendment metadata where available, current/historical version distinction, official source URL, and licence metadata. Legislation must be modeled separately from judgments; a section, schedule, regulation, or sub-provision can be an evidence unit, but the parent legal source and version context must remain visible.

Later international and specialist sources may include UK treaties and command papers, BAILII collections, EUR-Lex, HUDOC, UN treaty bodies, international court decisions, and ICRC IHL materials where terms permit. Every source family needs a provider assessment for licence, computational-analysis permission, source structure, update cadence, citation format, identifier stability, evidence granularity, parser risk, and applicability/version metadata. Do not model International Humanitarian Law as a jurisdiction; use legal domain, source family, issuing body, country or region, treaty/applicability metadata, and evidence refs separately.

## API Requirements

### App Search Endpoint

`POST /api/search/fetch` remains the app orchestration route for product UX. It can include stored search, optional foreground Find Case Law behavior, background hydration, demo status flags, and UI-oriented response shaping.

It should evolve to include:

- source type and source family filters
- jurisdiction and court or issuing body filters
- legal domain
- date range
- `asAtDate` for legislation
- result limit and cursor
- search mode
- evidence metadata toggle

### Stable Legal Source API

Future public routes should be versioned, stored-source-first, and contract-first:

- `GET /api/v1/legal/search`
- `GET /api/v1/legal/documents/:documentId`
- `GET /api/v1/legal/documents/:documentId/evidence`
- `GET /api/v1/legal/citations/resolve`
- `GET /api/v1/legal/legislation/:documentId/provisions/:provisionId`

Stable API behavior:

- default to stored Ormont legal sources
- no live provider fallback unless explicit, asynchronous, rate-limited, and auditable
- shared schemas in `packages/contracts`
- stable errors for validation, unavailable storage, rate limits, not found, and ambiguous queries
- lean result payloads with source provenance, licence metadata, evidence ids, match reasons, snippets, and ambiguity flags
- no provider internals, admin search keys, raw provider payloads, direct database access, or private matter indexes

## URL Requirements

Canonical Ormont URLs and official/provider source URLs are different fields and must not be collapsed into one `source_url` concept.

Target canonical Ormont routes:

- `/case/:caseSlug`
- `/case/:caseSlug/paragraph/:paragraphNumber`
- `/legislation/:lawSlug`
- `/legislation/:lawSlug/:provisionSlug`

Rules:

- Internal document ids remain valid storage keys, but public links use canonical slugs.
- Slugs resolve to stable source ids server-side.
- Old `/cases/:caseId` routes redirect to canonical `/case/:caseSlug` when the source is known.
- Ambiguous slugs return candidates rather than silently choosing a source.
- Search result payloads include a canonical Ormont URL so the UI does not reconstruct it ad hoc.
- Detail pages keep the official/provider source URL visible for provenance and licence inspection.

## Evidence Requirements

Search evidence must align with the canonical Evidence Unit model in [Verification Evidence](verification-evidence.md). Search result and snippet payloads should include or reference:

- `evidence_id`
- `source_id`
- `source_type`
- `source_title`
- `display_citation`
- canonical Ormont URL
- official/provider source URL
- `provider`
- `licence`
- `location_type`
- `location_ref`
- `version_ref`
- `excerpt_ref`
- `match_reason`
- `retrieval_rank`
- `retrieval_score`
- ambiguity flags

Snippets must be bounded and tied to evidence ids. Result-list payloads must not return full documents.

## UI And UX Requirements

Search screen:

- source-type tabs or segmented control
- source family, jurisdiction, court/body, date, and `asAtDate` controls
- active filter chips
- result count and source coverage state
- stored/live/acquisition state labels
- keyboard navigation across results
- clear empty states for not indexed, no match, provider unavailable, and ambiguous query

Result cards:

- title, citation or identifier, source type, court/body, date or version
- match reason and snippets with paragraph/provision labels
- provenance, licence status, evidence count, and warning flags for ambiguity, missing full text, or provider-only result

Source detail:

- judgment paragraph viewer and legislation provision viewer
- source metadata panel and search within source
- jump to paragraph/provision
- copy citation and canonical Ormont link
- open official source
- show indexed/hydrated status
- redirect internal-id URLs to canonical citation or legislation URLs

Internal or reviewer mode should show normalized query, query class, retrieval path, filters applied, rank, score, provider calls, and stored-search timeout or fallback state. Diagnostics must stay limited to authenticated internal users or explicit reviewer workflows.

## Benchmark Requirements

Search quality must be benchmarked before major ranking or corpus changes are treated as complete. The canonical benchmark framework is defined in [Bench](bench.md); Search contributes fixtures, expected outputs, and failure labels.

Initial judgment cases:

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

Initial legislation cases, once legislation ships:

- Act title
- short title
- year and chapter
- SI number
- section reference
- schedule reference
- `asAtDate` version query
- provision text phrase

Search metrics are top-1 and top-3 exact source success, evidence unit recall, no-answer precision, ambiguity surfaced, provider fallback rate, stored search latency, and snippet usefulness reviewer score.

## Functional Requirements

- Search must separate exact lookup from broad search.
- Search must return stable evidence ids for snippets.
- Search must expose match reasons and retrieval path.
- Search must support judgment and legislation source models.
- Search must support cursor or bounded pagination before corpus expansion.
- Search must track provider ingestion and hydration status.
- Search must expose source provenance and licence metadata.
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

- [Bench](bench.md): Search benchmark fixtures and quality gates for ranking and corpus changes.
- [Verification Evidence](verification-evidence.md): evidence id schema, evidence unit model, and evidence package export for Search result payloads.
- Shared contracts package (`packages/contracts`): type definitions for stable API routes and legal-source schemas.
- Provider licence assessments: required before corpus expansion to new source families or jurisdictions.
- Infrastructure: ingestion jobs, corpus refresh workers, and coverage reporting for stored-source reliability.

## Rollout

### Gate 1: Judgment Search Quality

Deliver exact lookup, richer result-card metadata, ambiguity state, non-judgment retrieval implementations, and executable Search benchmark run records. Canonical `/case/:caseSlug` result links, `/cases/:caseId` redirects, ranking labels, match reasons, retrieval path, rank, score, judgment evidence ids, explicit no-match/hydration outcomes, expanded source-type/request schemas, unsupported-source outcomes, and Gate 1 benchmark seed artifacts are already available.

Exit criteria:

- exact citations and document ids rank first
- search results link to canonical case URLs
- body-text matches show evidence snippets
- result payloads use canonical evidence field names where implemented
- no-answer and queued-hydration states are explicit
- ambiguous states are explicit
- benchmark runs record top-k results and failure labels

### Gate 2: Corpus Reliability

Deliver broader Find Case Law ingestion, ingestion coverage reporting, parser confidence, skipped-document reporting, and stored-source diagnostics.

Exit criteria:

- Search no longer depends mainly on user-triggered hydration
- stored corpus coverage is visible
- provider outage or rate-limit states are visible internally

### Gate 3: Legislation Search

Deliver legislation source schema, legislation.gov.uk adapter, canonical `/legislation/:lawSlug` routing, provision indexing, `asAtDate`, legislation UI filters, and legislation detail views.

Exit criteria:

- users can find an Act, SI, section, schedule, and provision text
- version-sensitive results expose date context
- official legislation URLs remain visible alongside canonical Ormont URLs

### Gate 4: Stable API And Tool Readiness

Deliver `/api/v1/legal/*` routes, shared contracts, evidence metadata, API-key scoped readiness, and MCP-safe retrieval operations.

Exit criteria:

- tool callers can retrieve legal sources without provider internals or admin credentials
- stable API responses default to stored sources and expose predictable error shapes

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
