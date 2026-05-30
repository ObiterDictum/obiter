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

The broader case-law and legislation search quality target is defined in `docs/phase-1-atlas.md`. This DMU slice should not implement full statute/provision search, but it must avoid choices that block that model later.

One Search surface must support:

- neutral citation lookup
- case title and party-name lookup
- document id or provider-derived slug lookup
- keyword lookup over stored source metadata
- keyword lookup over judgment body text
- court, jurisdiction, source type, and date filters
- stored-source-first behavior before live provider calls
- Find Case Law fallback on stored misses where the request is safe and supported

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

Body-text matches should still return the case, not the paragraph as a separate result. The result card should show body snippets so the user can see why the case matched.

Provider fallback is not a substitute for stored body search. Find Case Law can be used for live title, citation, and provider keyword discovery, but full body-text search is only reliable for stored or hydrated cases whose paragraphs have been indexed or persisted.

## Source Extensibility

The current implementation is a judgment-only slice. Adding countries, statutes, guidance, treaties, secondary materials, or other legal sources must be treated as source onboarding work, not a small enum change.

Do not force all legal sources through the current case-law `LegalAuthority` shape. Future source types need source-specific schemas:

- Judgments: neutral citations, court, date decided, judgment paragraphs, source document URI, provider metadata.
- Legislation: title, legislation type, year/number, jurisdiction, issuing body, provisions, amendment history, commencement state, version ranges, and "as at" date behavior.
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
- legal domain
- source type
- provider
- licence and usage permissions

Identifiers must be provider-aware and stable enough to avoid collisions across jurisdictions and providers.

Raw provider payloads should not be stored indefinitely in database JSON once the corpus grows. Keep hashes and metadata in PostgreSQL, and move large raw source artifacts to object storage with stable pointers and retention rules.

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
- Opening the result should go straight to `/cases/:caseId`.

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

1. Refactor `legal-search-proxy.ts` into `routes/legal-search/` with no behavior change.
2. Run targeted API tests and fix extraction regressions.
3. Add debounced auto-search using refs/timers.
4. Add API and UI result snippets.
5. Add or update tests for citation-first search, body-text search, snippet extraction, and stored-source fallback behavior.
6. Add keyboard navigation, idle state, and individual filter removal.
7. Run cleanup for deprecated fallbacks and empty scaffolds.
8. Run the verification commands below.

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
- `/cases/:caseId` detail page after opening a result

Do not mark this slice done if the refactor changes existing Search behavior without a deliberate follow-up note.
