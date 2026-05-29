# Search Experience And Refactor

## Purpose

This slice improves the existing Search experience for the DMU demo and reduces the risk of changing the current Find Case Law integration.

The immediate goal is not to build Matter Workspace, hosted storage, offline sync, Redaction, Verification, or Research. Those remain product goals, but they are not the next build step.

## Decisions

- Phase 0.3 and Phase 0.4 are paused for this demo slice.
- The initial route refactor has shipped: `services/api/src/routes/legal-search-proxy.ts` is now a compatibility re-export over `services/api/src/routes/legal-search/`.
- The route split itself was behavior-neutral and verified before UX work began.
- A deliberate follow-up ranking fix has shipped so strong title/party-name matches rank ahead of provider/body-reference-only hits.
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

## Implementation Status

Implemented on `search-experience-spec`:

- `services/api/src/routes/legal-search-proxy.ts` is a thin compatibility re-export.
- `services/api/src/routes/legal-search/index.ts` is the public Search route export.
- `services/api/src/routes/legal-search/proxy-routes.ts` owns `POST /api/search/fetch` and `GET /api/search/documents/:documentId`.
- `services/api/src/routes/legal-search/search-routes.ts` owns the existing non-proxy search route.
- `services/api/src/routes/legal-search/rate-limiter.ts` owns `createMojRateLimiter`.
- Proxy route tests now live under `services/api/src/routes/legal-search/__tests__/proxy-routes.test.ts` and are discovered by the API package test script.
- `packages/search-client` now ranks exact document id, exact neutral citation, exact title, title substring, and all-query-terms-in-title matches ahead of body/reference-only matches while preserving provider/search order within a match class.
- API and search-client regression tests cover the Potanina-style case where a provider result only mentioning the query should rank behind a title match.

Not implemented yet:

- Further extraction of the proxy route into `moj-client`, parser, source-store, schema, response utility, court utility, and document utility modules.
- Search result snippets.
- Debounced auto-search.
- Keyboard navigation.
- Idle state and court shortcuts.
- Individual filter removal.
- Search/Atlas compatibility cleanup.

## API Refactor

The first split of `services/api/src/routes/legal-search-proxy.ts` into `services/api/src/routes/legal-search/` is complete.

Implemented module layout:

- `index.ts`: public route exports
- `proxy-routes.ts`: `POST /api/search/fetch` and `GET /api/search/documents/:documentId`
- `search-routes.ts`: existing search routes moved from `services/api/src/routes/legal-search.ts`
- `rate-limiter.ts`: `createMojRateLimiter`

Remaining extraction targets:

- `moj-client.ts`: Find Case Law fetch, detail retrieval, hydration, and indexing orchestration
- `atom-parser.ts`: Atom entry parsing and Atom helper functions
- `html-parser.ts`: judgment HTML parsing, paragraph extraction, document parsing, text decoding, and hashing
- `source-store.ts`: source store interface, in-memory store, PostgreSQL store, stored record transforms, foreground record cache helper
- `court-utils.ts`: court mappings, court normalization, citation/path court derivation, search text normalization, document matching
- `fetch-schema.ts`: fetch request schema, document id schema, route-facing types
- `response-utils.ts`: API error helper, fetch response helper, summary hit transform, search filter transform
- `document-utils.ts`: document id/URI transforms, date extraction, neutral citation extraction

Tests mirror the structure under `services/api/src/routes/legal-search/__tests__/`.

The current API package runs tests with plain `vitest run`, and nested `__tests__` files are discovered by `pnpm --filter @ormont/api test`.

`legal-search-proxy.ts` remains as a thin re-export during the transition.

The route split did not intentionally change response shapes, provider calls, indexing behavior, storage behavior, or error handling. The subsequent ranking fix is an intentional behavior change and is documented under Search Semantics.

## Search Semantics

Search should keep the way cases are currently found and add body-text visibility.

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

Current implementation:

- `rankLegalSearchHitsByExactMatch` enforces exact document id, exact neutral citation, exact title, title substring, and all-query-terms-in-title priority.
- The ranking helper is applied to Meilisearch hits, source-store fallback hits, and foreground live Find Case Law hits.
- Hits with the same ranking class preserve the existing provider/search order, so date or provider relevance can continue to break ties where the upstream path already ordered them.

Body-text matches should still return the case, not the paragraph as a separate result. The result card should show body snippets so the user can see why the case matched.

Provider fallback is not a substitute for stored body search. Find Case Law can be used for live title, citation, and provider keyword discovery, but full body-text search is only reliable for stored or hydrated cases whose paragraphs have been indexed or persisted.

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

1. Done: refactor `legal-search-proxy.ts` into `routes/legal-search/` with compatibility re-exports.
2. Done: run targeted API/search-client tests and fix the title-match ranking regression found during browser validation.
3. Next: add debounced auto-search using refs/timers.
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

- done: exact citation queries rank the matching case first
- done: title/party-name matches rank ahead of body/reference-only matches
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

The first route split is done. Do not mark the broader Search experience slice done until the remaining UX, snippets, fallback, cleanup, and manual verification items above have shipped.
