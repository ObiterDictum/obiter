import { Hono } from 'hono'
import {
  createClient,
  rankLegalSearchHitsByExactMatch,
  search,
  type LegalSearchFilters,
} from '@ormont/search-client'
import type { ApiEnv } from '../../env'
import { isSupportedFindCaseLawRequest } from './atom-parser'
import { createMojRateLimiter } from './rate-limiter'
import { legalDocumentIdSchema, legalFetchRequestSchema, type LegalFetchRequest } from './fetch-schema'
import { apiError, toFetchResponse, toSummaryHit, type LegalFetchSearchHit } from './response-utils'
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
}

const storedSearchTimeoutMs = 350

export function createLegalSearchProxyRoutes(
  env: ApiEnv,
  legalAuthorityStore: LegalAuthoritySourceStore = createInMemoryLegalAuthoritySourceStore(),
) {
  const app = new Hono<{ Variables: LegalSearchProxyRouteVariables }>()
  const searchClient = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)
  const indexClient = createClient(env.meilisearchHost, env.meilisearchAdminApiKey)
  const mojRateLimiter = createMojRateLimiter(env.mojFindCaseLawRateLimit)
  const foregroundSourceRecords = new Map<string, StoredLegalAuthorityRecord>()

  app.post('/api/search/fetch', async (c) => {
    const requestId = c.get('requestId')
    const parsed = legalFetchRequestSchema.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success || !isSupportedFindCaseLawRequest(parsed.data)) {
      return c.json(
        apiError('validation_failed', 'Fetch search request is invalid.', requestId),
        400,
      )
    }

    const filters = toSearchFilters(parsed.data)
    const cached = await searchStoredAuthorities(
      searchClient,
      env.legalAuthoritiesIndex,
      parsed.data.query,
      filters,
    )

    if (cached.hits.length > 0) {
      return c.json(
        toFetchResponse(cached.hits.map(toSummaryHit), parsed.data.query, true, 0, 0),
      )
    }

    const storedDocuments = await searchLegalAuthoritySourceStore(
      legalAuthorityStore,
      parsed.data.query,
      filters,
    )
    if (storedDocuments.length > 0) {
      const rankedStoredDocuments = rankLegalSearchHitsByExactMatch(
        storedDocuments,
        parsed.data.query,
      )

      return c.json(
        toFetchResponse(rankedStoredDocuments.map(toSummaryHit), parsed.data.query, true, 0, 0),
      )
    }

    if (!parsed.data.foregroundLiveResults) {
      void hydrateMojAuthoritiesFromSearch(
        env,
        legalAuthorityStore,
        indexClient,
        env.legalAuthoritiesIndex,
        parsed.data,
        mojRateLimiter,
      )

      return c.json(
        toFetchResponse(
          [],
          parsed.data.query,
          false,
          0,
          0,
          true,
        ),
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
          ...apiError('storage_unavailable', 'Find Case Law is rate limited.', requestId),
          retryAfter: liveResult.retryAfter,
        },
        503,
      )
    }

    if (liveResult.status === 'unavailable') {
      return c.json(
        apiError('storage_unavailable', 'Find Case Law is unavailable.', requestId),
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
        rankedLiveDocuments.map(toSummaryHit),
        parsed.data.query,
        false,
        0,
        liveResult.skippedCount,
        true,
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

    const storedSourceRecord = await getLegalAuthoritySourceRecord(legalAuthorityStore, parsed.data)
    const foregroundSourceRecord = foregroundSourceRecords.get(parsed.data)
    const sourceRecord = storedSourceRecord ?? foregroundSourceRecord ?? null
    const sourceRecordIsForegroundOnly = !storedSourceRecord && Boolean(foregroundSourceRecord)
    if (sourceRecord?.document) {
      return c.json({ document: sourceRecord.document })
    }

    const liveDocument = sourceRecord
      ? await fetchMojAuthorityDocumentFromRecord(env, sourceRecord, mojRateLimiter)
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
          void indexFetchedAuthorities(indexClient, env.legalAuthoritiesIndex, [liveDocument.document])
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
      void indexFetchedAuthorities(indexClient, env.legalAuthoritiesIndex, [liveDocument.document])
      return c.json({ document: liveDocument.document })
    }

    if (liveDocument.status === 'rate_limited') {
      return c.json(
        {
          ...apiError('storage_unavailable', 'Find Case Law is rate limited.', requestId),
          retryAfter: liveDocument.retryAfter,
        },
        503,
      )
    }

    if (liveDocument.status === 'unavailable') {
      return c.json(
        apiError('storage_unavailable', 'Find Case Law is unavailable.', requestId),
        503,
      )
    }

    return c.json(
      apiError('document_not_found', 'Document was not found in stored or live sources.', requestId),
      404,
    )
  })

  return app
}

async function searchStoredAuthorities(
  searchClient: Parameters<typeof search>[0],
  indexName: string,
  query: string,
  filters: LegalSearchFilters,
) {
  try {
    const result = await withTimeout(
      search(searchClient, indexName, query, filters),
      storedSearchTimeoutMs,
    )

    if (result) return result
  } catch {
  }

  return {
    hits: [],
    query,
    estimatedTotalHits: 0,
    processingTimeMs: 0,
  }
}

async function searchLegalAuthoritySourceStore(
  legalAuthorityStore: LegalAuthoritySourceStore,
  query: string,
  filters: LegalSearchFilters,
) {
  try {
    return (await withTimeout(
      legalAuthorityStore.search(query, filters),
      storedSearchTimeoutMs,
    )) ?? []
  } catch {
    return []
  }
}

async function getLegalAuthoritySourceRecord(
  legalAuthorityStore: LegalAuthoritySourceStore,
  documentId: string,
) {
  try {
    return await withTimeout(legalAuthorityStore.get(documentId), storedSearchTimeoutMs)
  } catch {
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
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

function toSearchFilters(request: LegalFetchRequest): LegalSearchFilters {
  return {
    court: request.court,
    jurisdiction: request.jurisdiction,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    sourceType: 'judgment',
  }
}


export { parseFindCaseLawAtom } from './atom-parser'
export { parseJudgmentParagraphs } from './html-parser'
export { createPostgresLegalAuthoritySourceStore } from './source-store'
export type { LegalFetchSearchHit } from './response-utils'
