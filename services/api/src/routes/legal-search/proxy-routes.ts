import { Hono } from 'hono'
import {
  createClient,
  rankLegalSearchHitsByExactMatch,
  search,
  type LegalSearchFilters,
  type LegalSearchHit,
} from '@obiter/search-client'
import type { ApiEnv } from '../../env'
import { readLimitedJsonValue } from '../../limited-request-body'
import {
  canonicalHydrationQueryKey,
  LegalSearchHydrationBudget,
} from '../../legal-search-hydration-budget'
import {
  isSupportedFindCaseLawRequest,
  createMojRateLimiter,
  legalDocumentIdSchema,
  legalFetchRequestSchema,
  type LegalFetchRequest,
  extractNeutralCitation,
} from '@obiter/legal-source-provider'
import {
  apiError,
  toFetchResponse,
  toSummaryHit,
  type LegalFetchSearchHit,
} from './response-utils'
import {
  createInMemoryLegalAuthoritySourceStore,
  rememberForegroundSourceRecord,
  toAuthoritySummary,
  type LegalAuthoritySourceStore,
  type StoredLegalAuthorityRecord,
} from './source-store'
import {
  fetchMojAuthorityDocumentById,
  fetchMojAuthorityDocumentFromRecord,
  fetchMojAuthoritySummaries,
  getStoredAuthorityDocument,
  hydrateMojAuthoritiesFromSearch,
  hydrateAndIndexMojAuthorities,
  indexFetchedAuthorities,
  atomEntryToAuthoritySummary,
  providerMetadataFromAtomEntry,
  upsertLegalAuthoritySummary,
  upsertLegalAuthorityDocument,
} from './moj-client'

interface LegalSearchProxyRouteVariables {
  requestId: string
  user: { id: string } | null
}

interface LegalSearchProxyRouteOptions {
  hydrationBudget?: LegalSearchHydrationBudget
}

const storedSearchTimeoutMs = 350
const storedCourtBrowseLimit = 10

export function createLegalSearchProxyRoutes(
  env: ApiEnv,
  legalAuthorityStore: LegalAuthoritySourceStore = createInMemoryLegalAuthoritySourceStore(),
  options: LegalSearchProxyRouteOptions = {},
) {
  const app = new Hono<{ Variables: LegalSearchProxyRouteVariables }>()
  const hydrationBudget =
    options.hydrationBudget ??
    new LegalSearchHydrationBudget({
      queueMax: env.legalSearchHydrationQueueMax,
      perClientMax: env.legalSearchHydrationPerClientMax,
      windowMs: env.legalSearchHydrationWindowMs,
    })
  const searchClient = createClient(
    env.meilisearchHost,
    env.meilisearchSearchApiKey,
  )
  const indexClient = createClient(
    env.meilisearchHost,
    env.meilisearchAdminApiKey,
  )
  const mojRateLimiter = createMojRateLimiter(env.mojFindCaseLawRateLimit)
  const foregroundSourceRecords = new Map<string, StoredLegalAuthorityRecord>()

  app.post('/api/search/fetch', async (c) => {
    const requestId = c.get('requestId')
    const body = await readLimitedJsonValue(c, env.jsonBodyMaxBytes)
    if (!body.ok) return body.response

    const parsed = legalFetchRequestSchema.safeParse(body.value)

    if (
      !parsed.success ||
      !isSupportedFindCaseLawRequest(parsed.data) ||
      !isSupportedFetchSearchMode(parsed.data)
    ) {
      return c.json(
        apiError(
          'validation_failed',
          'Fetch search request is invalid.',
          requestId,
        ),
        400,
      )
    }

    if (!isImplementedFetchSourceType(parsed.data)) {
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'unsupported_source_type',
          diagnostics: {
            storedIndexSearched: false,
            storedSourceSearched: false,
            liveProviderSearched: false,
            storedOnlyBrowse: false,
          },
        }),
      )
    }

    const filters = toSearchFilters(parsed.data)
    const storedOnlyBrowse = isStoredOnlyBrowse(parsed.data)
    const exactLookup = classifyExactLookup(parsed.data.query)
    const exactStoredAuthority =
      !storedOnlyBrowse && exactLookup
        ? await findExactStoredAuthority(
            searchClient,
            legalAuthorityStore,
            env.legalAuthoritiesIndex,
            parsed.data.query,
            filters,
            exactLookup,
          )
        : null

    if (exactStoredAuthority) {
      return c.json(
        toFetchResponse(
          [
            toSummaryHit(exactStoredAuthority.hit, parsed.data.query, {
              retrievalPath: 'stored_exact_lookup',
              retrievalRank: 1,
            }),
          ],
          parsed.data.query,
          true,
          0,
          0,
          false,
          {
            diagnostics: {
              exactLookupSearched: true,
              storedIndexSearched: true,
              storedSourceSearched: exactStoredAuthority.storedSourceSearched,
              liveProviderSearched: false,
              storedOnlyBrowse,
              storedIndexStatus: exactStoredAuthority.storedIndexStatus,
            },
          },
        ),
      )
    }

    const cached = await searchStoredAuthorities(
      searchClient,
      env.legalAuthoritiesIndex,
      parsed.data.query,
      filters,
      storedOnlyBrowse ? storedCourtBrowseLimit : undefined,
    )

    if (cached.hits.length > 0) {
      return c.json(
        toFetchResponse(
          cached.hits.map((hit, index) =>
            toSummaryHit(hit, parsed.data.query, {
              retrievalPath: 'stored_index',
              retrievalRank: index + 1,
            }),
          ),
          parsed.data.query,
          true,
          0,
          0,
          false,
          {
            diagnostics: {
              exactLookupSearched: Boolean(exactLookup),
              storedIndexSearched: true,
              storedSourceSearched: false,
              liveProviderSearched: false,
              storedOnlyBrowse,
              storedIndexStatus: cached.storedIndexStatus,
            },
          },
        ),
      )
    }

    const storedDocuments = await searchLegalAuthoritySourceStore(
      legalAuthorityStore,
      parsed.data.query,
      filters,
    )
    if (storedDocuments.length > 0) {
      const rankedStoredDocuments = rankLegalSearchHitsByExactMatch(
        limitStoredBrowseHits(storedDocuments, storedOnlyBrowse),
        parsed.data.query,
      )

      return c.json(
        toFetchResponse(
          rankedStoredDocuments.map((hit, index) =>
            toSummaryHit(hit, parsed.data.query, {
              retrievalPath: 'stored_source',
              retrievalRank: index + 1,
            }),
          ),
          parsed.data.query,
          true,
          0,
          0,
          false,
          {
            diagnostics: {
              exactLookupSearched: Boolean(exactLookup),
              storedIndexSearched: true,
              storedSourceSearched: true,
              liveProviderSearched: false,
              storedOnlyBrowse,
              storedIndexStatus: cached.storedIndexStatus,
            },
          },
        ),
      )
    }

    if (!parsed.data.query.trim()) {
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'stored_browse_empty',
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            storedSourceSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            storedIndexStatus: cached.storedIndexStatus,
          },
        }),
      )
    }

    const sessionUser = c.get('user') ?? null

    if (!sessionUser) {
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'no_match',
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            storedSourceSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            storedIndexStatus: cached.storedIndexStatus,
          },
        }),
      )
    }

    if (!parsed.data.foregroundLiveResults) {
      const hydrationKey = canonicalHydrationQueryKey(parsed.data)
      const enqueue = hydrationBudget.tryBeginHydration(
        sessionUser.id,
        hydrationKey,
      )
      if (enqueue.status === 'budget_exceeded') {
        return c.json(
          apiError(
            'hydration_budget_exceeded',
            'Search hydration budget exceeded. Try again later.',
            requestId,
          ),
          429,
        )
      }

      if (enqueue.status === 'queued') {
        void hydrateMojAuthoritiesFromSearch(
          env,
          legalAuthorityStore,
          indexClient,
          env.legalAuthoritiesIndex,
          parsed.data,
          mojRateLimiter,
        ).finally(() => hydrationBudget.completeHydration(hydrationKey))
      }

      // Deduped still has an in-flight job; keep hydrationQueued true so clients poll.
      return c.json(
        toFetchResponse([], parsed.data.query, false, 0, 0, true, {
          outcome: 'hydration_queued',
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            storedSourceSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            storedIndexStatus: cached.storedIndexStatus,
          },
        }),
      )
    }

    const liveResult = await fetchMojAuthoritySummaries(
      env,
      parsed.data,
      mojRateLimiter,
    )

    if (liveResult.status === 'rate_limited') {
      return c.json(
        {
          ...apiError(
            'storage_unavailable',
            'Find Case Law is rate limited.',
            requestId,
          ),
          retryAfter: liveResult.retryAfter,
        },
        503,
      )
    }

    if (liveResult.status === 'unavailable') {
      return c.json(
        apiError(
          'storage_unavailable',
          'Find Case Law is unavailable.',
          requestId,
        ),
        503,
      )
    }

    for (const entry of liveResult.entries) {
      rememberForegroundSourceRecord(
        foregroundSourceRecords,
        atomEntryToAuthoritySummary(env, entry),
        providerMetadataFromAtomEntry(entry),
      )
      await upsertLegalAuthoritySummary(
        legalAuthorityStore,
        atomEntryToAuthoritySummary(env, entry),
        providerMetadataFromAtomEntry(entry),
      )
    }

    void hydrateAndIndexMojAuthorities(
      env,
      legalAuthorityStore,
      indexClient,
      env.legalAuthoritiesIndex,
      liveResult.entries,
      mojRateLimiter,
    )

    const rankedLiveDocuments = rankLegalSearchHitsByExactMatch(
      liveResult.documents,
      parsed.data.query,
    )

    return c.json(
      toFetchResponse(
        rankedLiveDocuments.map((hit, index) =>
          toSummaryHit(hit, parsed.data.query, {
            retrievalPath: 'live_provider',
            retrievalRank: index + 1,
          }),
        ),
        parsed.data.query,
        false,
        0,
        liveResult.skippedCount,
        true,
        {
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            storedSourceSearched: true,
            liveProviderSearched: true,
            storedOnlyBrowse,
            storedIndexStatus: cached.storedIndexStatus,
          },
        },
      ),
    )
  })

  app.get('/api/search/documents/:documentId', async (c) => {
    const requestId = c.get('requestId')
    const parsed = legalDocumentIdSchema.safeParse(c.req.param('documentId'))

    if (!parsed.success) {
      return c.json(
        apiError('validation_failed', 'Document id is invalid.', requestId),
        400,
      )
    }

    const document = await getStoredAuthorityDocument(
      indexClient,
      env.legalAuthoritiesIndex,
      parsed.data,
    )

    if (document) {
      return c.json({ document })
    }

    const storedSourceRecord = await getLegalAuthoritySourceRecord(
      legalAuthorityStore,
      parsed.data,
    )
    const foregroundSourceRecord = foregroundSourceRecords.get(parsed.data)
    const sourceRecord = storedSourceRecord ?? foregroundSourceRecord ?? null
    const sourceRecordIsForegroundOnly =
      !storedSourceRecord && Boolean(foregroundSourceRecord)
    if (sourceRecord?.document) {
      return c.json({ document: sourceRecord.document })
    }

    const liveDocument = sourceRecord
      ? await fetchMojAuthorityDocumentFromRecord(
          env,
          sourceRecord,
          mojRateLimiter,
        )
      : await fetchMojAuthorityDocumentById(env, parsed.data, mojRateLimiter)

    if (liveDocument.status === 'ok') {
      try {
        await upsertLegalAuthorityDocument(
          legalAuthorityStore,
          liveDocument.document,
          liveDocument.provider,
        )
        rememberForegroundSourceRecord(
          foregroundSourceRecords,
          toAuthoritySummary(liveDocument.document),
          liveDocument.provider,
          liveDocument.document,
        )
      } catch {
        if (sourceRecordIsForegroundOnly) {
          rememberForegroundSourceRecord(
            foregroundSourceRecords,
            toAuthoritySummary(liveDocument.document),
            liveDocument.provider,
            liveDocument.document,
          )
          void indexFetchedAuthorities(indexClient, env.legalAuthoritiesIndex, [
            liveDocument.document,
          ])
          return c.json({ document: liveDocument.document })
        }

        return c.json(
          apiError(
            'storage_unavailable',
            'Legal source storage is unavailable.',
            requestId,
          ),
          503,
        )
      }
      void indexFetchedAuthorities(indexClient, env.legalAuthoritiesIndex, [
        liveDocument.document,
      ])
      return c.json({ document: liveDocument.document })
    }

    if (liveDocument.status === 'rate_limited') {
      return c.json(
        {
          ...apiError(
            'storage_unavailable',
            'Find Case Law is rate limited.',
            requestId,
          ),
          retryAfter: liveDocument.retryAfter,
        },
        503,
      )
    }

    if (liveDocument.status === 'unavailable') {
      return c.json(
        apiError(
          'storage_unavailable',
          'Find Case Law is unavailable.',
          requestId,
        ),
        503,
      )
    }

    return c.json(
      apiError(
        'document_not_found',
        'Document was not found in stored or live sources.',
        requestId,
      ),
      404,
    )
  })

  return app
}

function isSupportedFetchSearchMode(request: LegalFetchRequest) {
  return Boolean(request.query.trim()) || Boolean(request.court)
}

function isStoredOnlyBrowse(request: LegalFetchRequest) {
  return !request.query.trim() && Boolean(request.court)
}

function isImplementedFetchSourceType(request: LegalFetchRequest) {
  return !request.sourceType || request.sourceType === 'judgment'
}

function limitStoredBrowseHits<T>(hits: T[], storedOnlyBrowse: boolean) {
  return storedOnlyBrowse ? hits.slice(0, storedCourtBrowseLimit) : hits
}

type ExactLookup =
  | { kind: 'document_id'; normalizedQuery: string }
  | { kind: 'neutral_citation'; normalizedQuery: string }

function classifyExactLookup(query: string): ExactLookup | null {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return null

  if (isExactDocumentId(normalizedQuery)) {
    return { kind: 'document_id', normalizedQuery }
  }

  const extractedCitation = extractNeutralCitation(query)
  if (
    extractedCitation &&
    normalizeSearchValue(extractedCitation) === normalizedQuery
  ) {
    return { kind: 'neutral_citation', normalizedQuery }
  }

  return null
}

async function findExactStoredAuthority(
  searchClient: Parameters<typeof search>[0],
  legalAuthorityStore: LegalAuthoritySourceStore,
  indexName: string,
  query: string,
  filters: LegalSearchFilters,
  lookup: ExactLookup,
) {
  const storedIndexResult = await searchStoredAuthorities(
    searchClient,
    indexName,
    query,
    filters,
    5,
  )
  const storedIndexStatus = storedIndexResult.storedIndexStatus
  const storedIndexHit = storedIndexResult.hits.find((hit) =>
    isExactLookupHit(hit, lookup),
  )
  if (storedIndexHit)
    return {
      hit: storedIndexHit,
      storedSourceSearched: false,
      storedIndexStatus,
    }

  if (lookup.kind === 'document_id') {
    const storedRecord = await getLegalAuthoritySourceRecord(
      legalAuthorityStore,
      lookup.normalizedQuery,
    )
    const storedDocument = storedRecord?.document ?? storedRecord?.summary
    if (storedDocument && sourceMatchesFilters(storedDocument, filters)) {
      return {
        hit: storedDocument,
        storedSourceSearched: true,
        storedIndexStatus,
      }
    }
  }

  const storedSourceHits = await searchLegalAuthoritySourceStore(
    legalAuthorityStore,
    query,
    filters,
  )
  const storedSourceHit = storedSourceHits.find((hit) =>
    isExactLookupHit(hit, lookup),
  )
  return storedSourceHit
    ? { hit: storedSourceHit, storedSourceSearched: true, storedIndexStatus }
    : null
}

function isExactDocumentId(normalizedQuery: string) {
  return (
    /^d-[a-z0-9-]+$/.test(normalizedQuery) ||
    /^[a-z][a-z0-9-]*(?:-[a-z0-9]+)*-\d{4}-\d+$/.test(normalizedQuery)
  )
}

function isExactLookupHit(hit: LegalFetchSearchHit, lookup: ExactLookup) {
  switch (lookup.kind) {
    case 'document_id':
      return normalizeSearchValue(hit.id) === lookup.normalizedQuery
    case 'neutral_citation':
      return (
        normalizeSearchValue(hit.neutralCitation) === lookup.normalizedQuery
      )
  }
}

function sourceMatchesFilters(
  hit: LegalFetchSearchHit,
  filters: LegalSearchFilters,
) {
  if (filters.court && hit.court !== filters.court) return false
  if (filters.jurisdiction && hit.jurisdiction !== filters.jurisdiction)
    return false
  if (filters.sourceType && hit.sourceType !== filters.sourceType) return false
  if (filters.dateFrom && hit.dateDecided < filters.dateFrom) return false
  if (filters.dateTo && hit.dateDecided > filters.dateTo) return false
  return true
}

type StoredIndexStatus = 'ok' | 'unavailable'

interface StoredAuthoritiesResult {
  hits: LegalSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
  storedIndexStatus: StoredIndexStatus
}

async function searchStoredAuthorities(
  searchClient: Parameters<typeof search>[0],
  indexName: string,
  query: string,
  filters: LegalSearchFilters,
  limit?: number,
): Promise<StoredAuthoritiesResult> {
  // A stored-index failure is reported, not swallowed: the caller carries
  // storedIndexStatus into response diagnostics so a broken engine never
  // reads as "no results". Only the error message is logged — RULES.md
  // forbids secrets in logs, so the provider cause is never serialised.
  try {
    const searchOptions =
      typeof limit === 'number'
        ? { includeSnippets: true, limit }
        : { includeSnippets: true }
    const result = await withTimeout(
      search(searchClient, indexName, query, filters, searchOptions),
      storedSearchTimeoutMs,
    )

    if (!result) {
      console.error(
        'Stored Meilisearch search timed out — falling back to Postgres FTS without typo tolerance.',
        { indexName, timeoutMs: storedSearchTimeoutMs },
      )
      return {
        hits: [],
        query,
        estimatedTotalHits: 0,
        processingTimeMs: 0,
        storedIndexStatus: 'unavailable',
      }
    }

    return {
      ...result,
      hits:
        typeof limit === 'number' ? result.hits.slice(0, limit) : result.hits,
      storedIndexStatus: 'ok',
    }
  } catch (error: unknown) {
    console.error(
      'Stored Meilisearch search failed — falling back to Postgres FTS without typo tolerance.',
      {
        indexName,
        reason: error instanceof Error ? error.message : String(error),
      },
    )
    return {
      hits: [],
      query,
      estimatedTotalHits: 0,
      processingTimeMs: 0,
      storedIndexStatus: 'unavailable',
    }
  }
}

async function searchLegalAuthoritySourceStore(
  legalAuthorityStore: LegalAuthoritySourceStore,
  query: string,
  filters: LegalSearchFilters,
) {
  try {
    return (
      (await withTimeout(
        legalAuthorityStore.search(query, filters),
        storedSearchTimeoutMs,
      )) ?? []
    )
  } catch {
    return []
  }
}

async function getLegalAuthoritySourceRecord(
  legalAuthorityStore: LegalAuthoritySourceStore,
  documentId: string,
) {
  try {
    return await withTimeout(
      legalAuthorityStore.get(documentId),
      storedSearchTimeoutMs,
    )
  } catch {
    return null
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function normalizeSearchValue(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

function toSearchFilters(request: LegalFetchRequest): LegalSearchFilters {
  return {
    court: request.court,
    jurisdiction: request.jurisdiction,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    sourceType: request.sourceType ?? 'judgment',
  }
}

export { parseFindCaseLawAtom } from '@obiter/legal-source-provider'
export { parseJudgmentParagraphs } from '@obiter/legal-source-provider'
export { createPostgresLegalAuthoritySourceStore } from './source-store'
export type { LegalFetchSearchHit } from './response-utils'
