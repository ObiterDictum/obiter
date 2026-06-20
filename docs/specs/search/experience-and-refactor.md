# Search Experience And Refactor

## Purpose

This slice improves the existing Search experience for the DMU demo and reduces the risk of changing the current Find Case Law integration.

The immediate goal is not to build Matter Workspace, hosted storage, offline sync, Redaction, Verification, or Research. Those remain product goals, but they are not the next build step.

## Decisions

- Phase 0.3 and Phase 0.4 are paused for this demo slice.
- Refactor `services/api/src/routes/legal-search-proxy.ts` before adding user-facing behavior.
- The refactor must be behavior-neutral and verified before UX work begins.
- This refactor must not make the app-facing Search endpoint the permanent public API contract by accident. Keep app orchestration, stable legal-source retrieval, and future developer API concerns separated.
- Search result cards should show 1-2 matched snippets, not full paragraph payloads.
- Full judgment paragraphs belong on the case detail page.
- `POST /api/search/fetch` should expose `snippets?: LegalSearchSnippet[]` on hits and should not expose `paragraphs?: CaseLawParagraph[]` in search result payloads.
- Citation searches must resolve directly to matching cases. A query such as `[2024] UKSC 3` should show that case as the first result when it exists in stored sources or can be found through the live Find Case Law path.
- The search box must preserve the current case-search behavior for titles, parties, citations, document ids, filters, and Find Case Law fallback, while also searching the actual judgment body text for stored or hydrated cases.
- Debounced search should follow the repo React rules. Prefer timer/ref-driven event handling over `useEffect`.
- Dead-code cleanup happens last, after Search tests are green.

## Non-Goals

- Do not implement matter creation, document upload, object storage, BullMQ jobs, encrypted desktop cache, offline queueing, or reconnect sync in this slice.
- Do not implement legal verification, redaction, or research workflows.
- Do not perform a broad rename of every legacy `atlas` identifier.
- Do not return raw HTML snippets from the API.
- Do not ship the public Developer API, SDK, MCP server, or API-key management UI in this slice unless a separate task explicitly expands the scope.
- Do not expose live provider fallback as a default third-party API behavior. Public/API-key consumers should default to stored Ormont legal sources so latency, provider quotas, licensing constraints, and abuse controls remain predictable.

## API Refactor

Split `services/api/src/routes/legal-search-proxy.ts` into `services/api/src/routes/legal-search/`.

Target module layout:

- `index.ts`: public route exports
- `proxy-routes.ts`: `POST /api/search/fetch` and `GET /api/search/documents/:documentId`
- `moj-client.ts`: Find Case Law fetch, detail retrieval, hydration, and indexing orchestration
- `atom-parser.ts`: Atom entry parsing and Atom helper functions
- `html-parser.ts`: judgment HTML parsing, paragraph extraction, document parsing, text decoding, and hashing
- `source-store.ts`: source store interface, in-memory store, PostgreSQL store, stored record transforms, foreground record cache helper
- `court-utils.ts`: court mappings, court normalization, citation/path court derivation, search text normalization, document matching
- `rate-limiter.ts`: `createMojRateLimiter`
- `fetch-schema.ts`: fetch request schema, document id schema, route-facing types
- `response-utils.ts`: API error helper, fetch response helper, summary hit transform, search filter transform
- `document-utils.ts`: document id/URI transforms, date extraction, neutral citation extraction

Tests should mirror the structure under `services/api/src/routes/legal-search/__tests__/`.

The current API package runs tests with plain `vitest run`, so nested `__tests__` files should be discovered by default. If the refactor changes test placement, verify discovery by running `pnpm --filter @ormont/api test`. If discovery fails, either keep the tests co-located with the module files or update the package test script in the same refactor.

`legal-search-proxy.ts` may remain as a thin re-export during the transition, or be deleted if imports are updated in the same change.

The first refactor commit must not change response shapes, ranking behavior, provider calls, indexing behavior, storage behavior, or error handling.

## Public API, SDK, And MCP Readiness

Search should be prepared to become an API-key-protected public legal-source API, but this demo refactor should only create the right seams and contracts. It should not make the app-facing `/api/search/fetch` orchestration route the external developer contract.

Separate these surfaces:

- App Search endpoint: product UX orchestration for `/search`, including stored search, optional foreground Find Case Law behavior, background hydration, demo status flags, and UI-oriented response shaping.
- Stable legal-source API: versioned, stored-source-first retrieval surface intended for SDKs, MCP servers, integrations, and third-party app search.
- Provider ingestion/hydration: internal source acquisition and indexing workflows. External callers must not depend on provider-specific behavior such as Find Case Law Atom shapes, provider rate limits, or background indexing details.

Future public routes should be versioned and contract-first. Candidate routes:

- `GET /api/v1/legal/search`
- `GET /api/v1/legal/documents/:documentId`
- `GET /api/v1/legal/documents/:documentId/paragraphs`
- `GET /api/v1/legal/citations/resolve`

Those route names are design targets, not required build output for this slice.

Public API contracts should live in `packages/contracts` so the web app, desktop app, SDK, and MCP server consume the same request and response schemas. The SDK and MCP server should call the public API; they should not query PostgreSQL, Meilisearch, or provider services directly.

API-key auth requirements for the future Developer API:

- Store only hashed API keys. Never persist raw keys after creation.
- Use scoped keys, starting with read-only scopes such as `legal.search:read`, `legal.documents:read`, and `legal.citations:resolve`.
- Bind keys to an organisation and optionally to a user/service account.
- Track key prefix, name, scopes, created time, last-used time, revoked time, and rate-limit class.
- Audit key creation, revocation, and API use without logging raw keys, query-sensitive private matter data, or full legal payloads.
- Support server-side rate limits per key and per route family.
- Return stable error shapes for invalid keys, revoked keys, missing scopes, rate limits, validation failures, and storage/provider unavailability.

Public legal-source API behavior:

- Default to stored Ormont-owned legal sources only.
- Do not trigger live provider fetches by default.
- If a future route supports hydration requests, make that behavior explicit, asynchronous, rate-limited, and auditable.
- Keep result payloads lean: summary metadata plus snippets or exact paragraph/provision references, not whole documents.
- Support pagination before result sets can grow without bounds.
- Keep response ordering and ranking deterministic enough for SDK/MCP callers to cache and test.
- Include source provenance, licence metadata, and computational-analysis permission metadata once those fields exist in storage.
- Support future model/tool callers by returning stable source ids, evidence ids, match reasons, snippets, and ambiguity flags rather than prose-only results.

AI integration readiness:

- Search may provide model-facing retrieval and evidence-pack APIs in future work, but answer generation belongs to Research and trust checking belongs to Verify.
- Model query planning must produce a validated structured search plan before Search executes provider or index queries.
- Models, SDKs, and MCP tools may use Meilisearch-backed retrieval. The preferred route is the Search API, but direct Meilisearch access is acceptable for deliberately public legal-source indexes when using scoped search-only keys.
- Models, SDKs, and MCP tools must not receive Meilisearch admin keys, private matter indexes, direct database access, raw provider access, or access to indexes containing private client material.
- Search logs must not store raw prompts or private matter text. Matter-aware AI orchestration belongs in Research or Verify, where redaction, audit, and permission controls can be applied.
- Generated answers must cite exact paragraphs or provisions and should be checked by Verify before being presented as reliable analysis.

MCP readiness:

- MCP tools should wrap the same stable public API contracts.
- Search tools should expose narrow operations such as search legal sources, resolve citation, fetch document metadata, and fetch paragraph/provision text.
- MCP responses should include source identifiers and URLs so host apps can display citations and let users inspect the original source.
- MCP tools must not expose provider internals, admin search keys, raw provider payloads, or app-session-only endpoints.

## Search Semantics

Search should keep the way cases are currently found and add body-text visibility.

This refactor is actively working on the judgment slice, but it must preserve the broader Search product model directly in this spec. Search should aim for the broadest legally usable public legal-source coverage Ormont can lawfully ingest, index, retrieve, and expose with reliable provenance. Phasing is an implementation and quality-control strategy, not a product coverage limit.

The active refactor must avoid choices that make later case law, legislation, international-law, SDK, MCP, and AI integrations expensive. The current Find Case Law path is one provider adapter and one source family, not the final shape of Search.

Current provider scope:

- Implemented case-law ingestion and hydration uses Find Case Law at `caselaw.nationalarchives.gov.uk`. The route module is still named `moj-client.ts` and the environment variables are still named `MOJ_FIND_CASE_LAW_*`, but the configured endpoint is The National Archives Find Case Law service.
- This gives Search broad coverage across the supported Find Case Law court and tribunal collections, subject to provider availability, parser support, and licensing constraints.
- `legislation.gov.uk` is not implemented yet. Legislation requires a separate provider adapter, schema, storage model, version/provision handling, and search semantics; do not treat the current judgment path as legislation ingestion.
- The current product behavior is stored Ormont legal sources first, then safe Find Case Law fallback/hydration for case-law misses. Future legislation search should be added source-by-source without weakening this case-law path.

One Search surface must support:

- neutral citation lookup
- case title and party-name lookup
- document id or provider-derived slug lookup
- keyword lookup over stored source metadata
- keyword lookup over judgment body text
- court, jurisdiction, source type, and date filters
- stored-source-first behavior before live provider calls
- Find Case Law fallback on stored misses where the request is safe and supported

Future-compatible Search requests should be able to grow toward:

- `query`: required for normal search; optional only for explicit bounded browse endpoints
- `sourceType`: judgment, legislation document, legislation provision, international instrument, decision, guidance, or other source types as they are added
- `jurisdiction`: controlled jurisdiction filter where the concept applies
- `courtOrBody`: court, tribunal, parliament, government department, international court, UN body, treaty body, or other issuing body
- `dateFrom` / `dateTo`: decision, publication, adoption, commencement, entry-into-force, or version date depending on source type
- `asAtDate`: required for version-sensitive legislation lookup once legislation is in scope
- `legalDomain`: controlled domain filter such as international-humanitarian-law, human-rights, criminal, commercial, or public-law
- `countryOrRegion`: domestic, regional, supranational, or international source-origin filter
- `instrumentType`: act, statutory instrument, treaty, convention, protocol, rule, resolution, guidance, decision, or other instrument types
- `issuingBody`: parliament, department, court, tribunal, UN body, treaty body, commission, or other authority
- `applicabilityContext`: future structured context for state, territory, conflict, treaty-party status, forum-specific applicability, or domestic implementation
- `provider`: optional source-provider filter for diagnostics and controlled corpus views
- `page` or `cursor` plus `limit`: required before result sets can grow without bounds

Search results should be discriminated by source type and share a stable envelope:

- canonical document id
- source type and source family
- title or canonical title
- jurisdiction when applicable
- legal domain
- country or region
- court, issuing body, or forum
- instrument type where applicable
- primary citation or preferred identifier
- relevant date and, for legislation or international instruments, applicable version or effective date range
- source URL and provider
- licence and computational-analysis permission metadata where available
- match reason such as exact citation, title match, paragraph match, provision match, or body-text match
- snippets or exact evidence references, not full document payloads
- ambiguity or applicability uncertainty flags where relevant

Judgment results should point to judgment paragraphs. Legislation results should point to provisions, headings, schedules, or versioned document records. International-law results should point to articles, rules, annexes, paragraphs, decisions, or other source-specific evidence units. Search should return the legal source as the primary result, not detached evidence fragments with no parent document context.

The current layered behavior must be preserved:

1. Search the stored Meilisearch index first.
2. If that misses or times out, search the PostgreSQL legal source store.
3. If stored sources miss, either queue Find Case Law hydration or return live foreground results when the request allows it.
4. Store provider metadata and hydrate/index detail pages in the background where possible.

Stored Meilisearch search must include body text. The current `@ormont/search-client` searchable attributes include:

- `id`
- `title`
- `neutralCitation`
- `court`
- `jurisdiction`
- `paragraphs.text`

That body-text behavior is part of the target experience. Do not remove `paragraphs.text` from the searchable attributes while adding snippets.

The PostgreSQL source-store fallback must not become weaker than the Meilisearch path for hydrated documents. If it is used for keyword search after documents have `document_json.paragraphs`, it should search body text as well as summary metadata. A search-provider outage should not silently reduce Search to citation/title-only lookup when the source store has hydrated paragraph text.

Ranking rules:

- exact document id match first
- exact neutral citation match next
- exact title/case-name match next
- strong title/party-name keyword matches next
- body-text paragraph matches after stronger metadata matches
- date ordering may break ties within the same match class
- semantic or vector retrieval may help discovery later, but it must not outrank exact identifiers, exact citations, known title aliases, exact provision references, or explicit evidence matches

Body-text matches should still return the case, not the paragraph as a separate result. The result card should show body snippets so the user can see why the case matched.

Provider fallback is not a substitute for stored body search. Find Case Law can be used for live title, citation, and provider keyword discovery, but full body-text search is only reliable for stored or hydrated cases whose paragraphs have been indexed or persisted.

### Case Law Rules

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

If a citation is ambiguous or maps to multiple records, Search should return disambiguation candidates with enough metadata to choose safely. It must not silently pick a result without exposing ambiguity.

### Legislation Rules

Legislation search is part of the Search product target, even though this slice does not implement it. It must not be modeled as judgment search with different labels.

Domestic legislation search must support:

- statute or instrument title lookup
- short title and common abbreviation lookup where aliases are explicitly stored
- year and number lookup, such as Act chapter or statutory instrument number
- provision lookup, including section, article, regulation, rule, schedule, paragraph, and sub-provision references
- keyword lookup over provision text, headings, and document metadata
- jurisdiction, issuing body, source type, date, and `asAtDate` filters
- in-force, repealed, prospective, and partially commenced states where available from the source
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

### International Law And Legislation Rules

International and transnational sources need their own search semantics. Search contracts and result types should be able to grow toward:

- treaties, conventions, protocols, optional protocols, annexes, and international instruments
- international court and tribunal judgments, decisions, advisory opinions, orders, and awards
- UN Security Council, General Assembly, Human Rights Council, treaty-body, and committee materials
- international humanitarian law instruments and customary-law references
- regional instruments such as Council of Europe, EU, African Union, Inter-American, or other regional materials when added deliberately

International-law search must support:

- title and short-title lookup, such as `Geneva Convention IV` or `ECHR`
- article, rule, protocol, annex, schedule, and paragraph references
- party or state-context filters when source data supports them
- adoption date, signature date, entry-into-force date, and version/effective date filters where applicable
- issuing body or forum filters, such as ICJ, ICC, ECtHR, UN Security Council, or treaty body
- legal-domain filters, especially for International Humanitarian Law and human rights
- source-family filters so users and model callers can distinguish treaty text from cases, soft law, guidance, and commentary-like materials

International-law results must expose applicability limits instead of overclaiming. Search should distinguish "text exists", "state-party/applicability unknown", "entered into force on this date", and "source supports this applicability claim" when the data allows it. If applicability metadata is missing, return the source with visible uncertainty rather than presenting it as settled law.

Do not collapse international law into a single jurisdiction value. Use separate fields for legal domain, source origin, issuing body, country or region, treaty parties, forum, and applicability metadata where available.

### Identifier Normalization

Search should use normalized lookup tables before broad keyword search for:

- neutral citations
- provider document ids and source URIs
- statute year/number identifiers
- provision identifiers
- treaty, convention, protocol, article, rule, and annex identifiers
- international court or tribunal case numbers and application numbers where available
- title aliases and short titles
- citation graph references once available

Normalization must preserve the original user query for display and audit, but ranking and equality checks should use canonical forms. Ambiguous, malformed, or unsupported citations should fail visibly or return candidates; they must not degrade into misleading keyword-only success.

## Source Extensibility

The current implementation is a judgment-only slice, but the Search product model should aim for the broadest legally usable public legal-source coverage Ormont can support. Adding countries, statutes, guidance, treaties, secondary materials, or other legal sources must be treated as source onboarding work, not a small enum change.

Do not force all legal sources through the current case-law `LegalAuthority` shape. Future source types need source-specific schemas:

- Judgments: neutral citations, court, date decided, judgment paragraphs, source document URI, provider metadata.
- Legislation: title, legislation type, year/number, jurisdiction, issuing body, provisions, amendment history, commencement state, version ranges, and "as at" date behavior.
- International law and international legislation: treaties, conventions, protocols, articles, rules, annexes, international court or tribunal decisions, UN or treaty-body materials, issuing body, legal domain, source origin, party/applicability metadata where sourced, and source-specific citation rules.
- Other sources: provider, issuing body, document structure, citation/identifier rules, licence metadata, and retrieval granularity defined per source type.

Adding a new source family should require:

- a provider adapter with explicit fetch, parse, normalize, hydrate, and provenance behavior
- source-specific schema and validation tests
- citation or identifier normalization tests
- storage mapping and index mapping
- source licence and computational-analysis permission metadata
- search ranking and filter behavior
- fixture coverage for malformed payloads, duplicate identifiers, withdrawn/replaced documents, and provider outages

The system should distinguish:

- country or sovereign source origin
- jurisdiction
- court or issuing body
- source family
- instrument type
- legal domain
- source type
- provider
- licence and usage permissions
- applicability metadata where available, such as treaty-party status, entry-into-force date, reservations, declarations, forum, territory, or implementation context

Identifiers must be provider-aware and stable enough to avoid collisions across jurisdictions and providers.

Raw provider payloads should not be stored indefinitely in database JSON once the corpus grows. Keep hashes and metadata in PostgreSQL, and move large raw source artifacts to object storage with stable pointers and retention rules.

### Legislation And International Law Readiness

This slice does not implement statute, provision, treaty, or international-law search. It must still avoid hard-coding assumptions that make those integrations expensive later.

This is an implementation sequencing constraint, not a product coverage limit. Search should be able to expand toward as much case law, legislation, and international legal material as licensing, provider access, parser reliability, and provenance allow.

Search contracts and result types should be able to grow toward:

- domestic legislation documents and provisions
- statutory instruments and regulations
- schedules, articles, rules, paragraphs, and sub-provisions
- treaties, conventions, protocols, annexes, and international instruments
- international court, tribunal, commission, and committee decisions
- UN, treaty-body, regional, or other international issuing-body materials
- legal-domain filters such as international-humanitarian-law and human-rights

Future legislation and international-law search must expose version, commencement, entry-into-force, and applicability uncertainty instead of presenting every source as current settled law. If those facts are not available from the source, responses should mark the gap rather than hide it.

Do not model International Humanitarian Law as a jurisdiction. Use legal domain, source family, issuing body, country or region, treaty/applicability metadata, and evidence references as separate concepts.

## Search UX

### Debounced Auto-Search

- Run search automatically after about 300 ms of query inactivity.
- Use a ref-held timer and the existing request id pattern to ignore stale responses.
- Abort previous fetches if practical, but stale responses must not update state.
- Empty or whitespace-only query returns the idle state.
- Loading state remains visible in the search bar.
- Submitting the search form should still run the current query immediately.
- Search input keeps focus after results load.

### Result Snippets

Search responses may include a lean snippet shape on each hit:

```ts
interface LegalSearchSnippet {
  paragraphId: string
  paragraphNumber: number
  text: string
  matchedTerms: string[]
}
```

The frontend contract should replace the current `paragraphs?: CaseLawParagraph[]` search-result field with `snippets?: LegalSearchSnippet[]` for search result cards. `CaseLawParagraph[]` remains valid for case detail pages and document retrieval, not result-list payloads.

Rules:

- Return at most 2 snippets per hit.
- Prefer paragraphs containing the exact normalized query.
- Then prefer paragraphs containing all query terms.
- Then prefer paragraphs containing any query term.
- Trim snippets around the first matched term with a target budget of about 60 characters before and 60 characters after the match. Return the full paragraph text only when it is already shorter than that budget.
- Do not return full `paragraphs` arrays from search result endpoints.
- Do not return HTML. The frontend owns safe highlighting with escaped text and `<mark>`.
- If no paragraph text is available, omit snippets for that hit.

The API can use `includeParagraphs` internally when reading from Meilisearch, but it should transform paragraphs into snippets before sending the response.

For the DMU demo corpus size, fetching paragraphs internally from Meilisearch to derive snippets is acceptable. If the corpus grows materially, replace this with a dedicated indexed snippet field or search-engine-native highlighting rather than moving full paragraph arrays through the result-list API.

### Citation Search

Citation queries are a first-class Search path, not just keyword searches.

Rules:

- Exact neutral citation matches rank ahead of title, paragraph, and partial keyword matches.
- Citation formatting variants should normalize where practical, including extra whitespace and slash/dash court filter differences.
- If an exact citation exists in stored sources, return it directly as the first result.
- If stored sources miss and foreground live lookup is enabled, Find Case Law results should still return the matching case directly when the provider exposes it.
- A citation search should not leave the user with only a queued hydration state when the matching live case can be returned safely in the foreground.
- Opening the result should go straight to the canonical `/case/:caseSlug` URL when the result payload includes one. `/cases/:caseId` remains as an internal-id compatibility route and redirects to the canonical route when the document is known.

Example:

- Query: `[2024] UKSC 3`
- Expected first result: `Potanina v Potanin`, `[2024] UKSC 3`

### Keyboard Navigation

- `ArrowDown` selects the next result.
- `ArrowUp` selects the previous result.
- `j` selects the next result when focus is in the Search surface and text entry is not being edited.
- `k` selects the previous result under the same condition.
- `Enter` opens the selected result when results are present.
- `Enter` runs the current query immediately when no result is selected.
- `?` opens a keyboard shortcuts overlay.
- `Escape` closes the overlay.
- Selection state must reset when a new query or filter set changes the result list.
- The keyboard shortcuts overlay should be a small presentational component, not a large inline block inside `LegalSearchView`.

### Idle State

When there is no active query, show an idle state below the search bar:

- recent searches from `sessionStorage`
- search tips: case name, neutral citation, keyword
- court shortcut buttons such as `UKSC`, `EWCA Civ`, and `EWHC`

Recent searches should avoid duplicates and keep only a small recent list.

Court shortcuts update the court filter. If a non-empty query is already present, the search should rerun through the normal debounce path.

If the query is empty, a court shortcut should run a bounded stored-source browse:

- return the latest 10 stored judgments for that court
- do not call Find Case Law with an unbounded or synthetic broad query
- label the result state as recent cases for that court
- omit snippets unless a safe stored paragraph match is available

This requires an explicit API path or schema branch for filter-only stored search. Do not loosen the Find Case Law fetch path to accept empty queries.

### Individual Filter Removal

Active filter badges should each expose a remove button.

Required badges:

- court
- date from
- date to

Removing one filter must preserve the other active filters and route through the same search state update path as applying filters.

## Dead-Code Cleanup

After refactor and UX tests pass:

- remove the `ATLAS_AUTHORITIES_INDEX` fallback from `services/api/src/env.ts`
- remove matching fallback tests from `services/api/src/env.test.ts`
- remove the same fallback from `services/legal-ingestor/src/env.ts`
- remove matching fallback tests from `services/legal-ingestor/src/env.test.ts`
- delete empty placeholder scaffolds for `services/bench-runner`, `services/redact-worker`, `services/verify-worker`, and any obsolete `services/atlas-ingestor` placeholder only if it no longer owns Search ingestion code
- keep `services/worker/README.md` unless a real worker package replaces it or the directory is removed deliberately

## Build Order

Current implementation status:

- [x] Refactor `legal-search-proxy.ts` into `routes/legal-search/` with no behavior change.
- [x] Run targeted API tests and fix extraction regressions.
- [x] Add debounced auto-search using refs/timers.
- [x] Add API and UI result snippets.
- [x] Add or update tests for citation-first search, body-text search, snippet extraction, and stored-source fallback behavior.
- [x] Add keyboard navigation, idle state, and individual filter removal.
- [x] Add canonical case URLs to Search result payloads and route result opening through `/case/:caseSlug`.
- [x] Add judgment result metadata for evidence ids, match reasons, retrieval path, retrieval rank, and retrieval score.
- [x] Redirect `/cases/:caseId` compatibility URLs to canonical `/case/:caseSlug` URLs when the document is known.
- [x] Add explicit Search response outcomes for results, no match, queued hydration, and empty stored-source browse.
- [x] Add Gate 1 judgment Search benchmark seed artifacts under `data/evals/search/`.
- [x] Expand source-type/source-family schemas and model future Search request fields with explicit unsupported-source outcomes.
- [ ] Run cleanup for deprecated fallbacks and empty scaffolds.
- [ ] Run the verification commands below after the remaining Search UX work.

Completed through PR 19:

- `POST /api/search/fetch` and `GET /api/search` include bounded `snippets` on result-list hits.
- Result-list responses continue to omit full `paragraphs` arrays.
- Snippet extraction lives in `@ormont/search-client`, ranks exact-query paragraph matches before all-term and any-term matches, returns at most two snippets, and omits snippets when no paragraph text matches safely.
- App-shell search result cards render snippet text below the result summary.
- Focused automated coverage exists for snippet extraction, result-list payload shape, citation-first ranking, body-text indexed search attributes, and stored-source fallback behavior.

Completed after PR 19:

- `POST /api/search/fetch` Search hits include `canonicalUrl` for judgment results, generated from shared helpers in `@ormont/contracts`.
- App-shell result links and keyboard result opening prefer canonical `/case/:caseSlug` URLs while preserving `/cases/:caseId` fallback behavior for old payloads.
- The web app has a `/case/$caseSlug` route that resolves current judgment citation slugs back to the existing document detail endpoint.
- The web app redirects `/cases/$caseId` compatibility routes to canonical case URLs after resolving the document.
- Focused automated coverage exists for canonical URL payloads, result links, and keyboard opening.
- Judgment Search payloads expose deterministic paragraph evidence ids, hit-level `evidenceIds`, `matchReason`, `retrievalPath`, `retrievalRank`, and `retrievalScore`.
- App-shell result cards show the match reason and retrieval path so result confidence is visible in the Search UI.
- Search fetch responses expose `outcome` and diagnostics fields so empty Search states no longer rely only on `hits.length` or `hydrationQueued`.
- App-shell empty states distinguish no indexed match, queued hydration, and empty stored-source browse.
- `data/evals/search/judgment-search-gate-1.*.json` defines the first Search benchmark dataset card, benchmark metadata, and 10 cases covering exact citation, document id, title, body text, no-answer, malformed citation, ambiguity, court browse, and date filters.
- `LegalSourceTypeSchema` now models judgment, legislation, international, guidance, and other source types; Search request schemas accept source family, legal domain, provider, topic, `asAtDate`, and legislation version fields.
- Non-judgment Search requests return an explicit `unsupported_source_type` outcome instead of being coerced into judgment Search.
- Exact judgment document-id and neutral-citation queries run through a stored exact-lookup path before broad keyword search and report `stored_exact_lookup` in result metadata.

Remaining next slice:

- Extend exact lookup to provision references, title aliases, malformed citations, and ambiguity/rejected-source states.
- Build the local Search benchmark runner that consumes the `data/evals/search/` seed artifacts and records top-k results plus failure labels.
- Manually exercise `/search` against a running API, Meilisearch, and Postgres stack.
- Run dead-code cleanup and the full verification list.

## Verification

Minimum automated checks:

```bash
pnpm --filter @ormont/api test
pnpm --filter @ormont/search-client test
pnpm --filter @ormont/app-shell test
pnpm --filter @ormont/app-shell typecheck
pnpm --filter @ormont/web build
```

Required focused coverage:

- exact citation queries rank the matching case first
- body-text queries can return cases through `paragraphs.text`
- result-list payloads expose snippets, not full paragraph arrays
- result-list payloads expose evidence ids, match reasons, retrieval path, rank, and score
- result-list responses expose explicit outcome states for results and no-result cases
- PostgreSQL source-store fallback searches hydrated body text when paragraph text is available
- live Find Case Law fallback still works for stored misses without weakening stored search behavior

Also manually exercise:

- `/search` idle state
- typing a query and seeing debounced results
- exact citation search, such as `[2024] UKSC 3`, returning the matching case first
- body-text search returning a case because a judgment paragraph matches
- filter apply and single-filter removal
- snippets on result cards
- keyboard result navigation and opening
- `/case/:caseSlug` detail page after opening a result
- `/cases/:caseId` compatibility redirect

Do not mark this slice done if the refactor changes existing Search behavior without a deliberate follow-up note.
