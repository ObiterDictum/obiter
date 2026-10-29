import { Hono } from 'hono'
import {
  createClient,
  normalizeExactMatchValue,
  search,
  type LegalSearchFilters,
  type LegalSearchHit,
} from '@obiter/search-client'
import type { ApiEnv } from '../../env'
import type { Pool } from 'pg'
import { readLimitedJsonValue } from '../../limited-request-body'
import {
  isSupportedFindCaseLawRequest,
  legalDocumentIdSchema,
  legalFetchRequestSchema,
  type LegalFetchRequest,
  extractNeutralCitation,
} from '@obiter/legal-source-provider'
import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts'
import type {
  CaseLawSummaryResponse,
  LegalSearchCitationStatus,
} from '@obiter/contracts'
import {
  apiError,
  toFetchResponse,
  toSummaryHit,
  type LegalFetchOutcome,
  type LegalFetchSearchHit,
} from './response-utils'
import {
  createInMemoryLegalAuthoritySourceStore,
  type LegalAuthorityReadStore,
  type StoredLegalAuthorityRecord,
} from './source-store'
import { resolveLegislationActPage } from './legislation-act'
import {
  resolveLegislationFetch,
  resolveLegislationProvisionPage,
  type LegislationFetchResult,
} from './legislation-serve'
import { getStoredAuthorityDocument } from './stored-document'

interface LegalSearchProxyRouteVariables {
  requestId: string
}

interface LegalSearchProxyRouteOptions {
  legislation?: {
    pool: Pool
    indexName: string
  }
}

const storedSearchTimeoutMs = 2000
const storedCourtBrowseLimit = 10
const storedIndexRerankPoolLimit = 100
const servedStoredHitsLimit = 20

type SettledSearchHalf<T> =
  { status: 'settled'; value: T } | { status: 'failed' }

function settleSearchHalf<T>(
  promise: Promise<T>,
  requestId: string,
  half: string,
): Promise<SettledSearchHalf<T>> {
  return promise.then(
    (value) => ({ status: 'settled' as const, value }),
    (error: unknown) => {
      console.error('Legal search half failed', {
        requestId,
        half,
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: 'failed' as const }
    },
  )
}

export function createLegalSearchProxyRoutes(
  env: ApiEnv,
  reads: LegalAuthorityReadStore = createInMemoryLegalAuthoritySourceStore(),
  options: LegalSearchProxyRouteOptions = {},
) {
  const app = new Hono<{ Variables: LegalSearchProxyRouteVariables }>()
  const searchClient = createClient(
    env.meilisearchHost,
    env.meilisearchSearchApiKey,
  )
  const indexClient = createClient(
    env.meilisearchHost,
    env.meilisearchAdminApiKey,
  )

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

    const foregroundLiveRequested = parsed.data.foregroundLiveResults === true

    if (!isImplementedFetchSourceType(parsed.data)) {
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'unsupported_source_type',
          diagnostics: {
            storedIndexSearched: false,
            liveProviderSearched: false,
            foregroundLiveIgnored: foregroundLiveRequested || undefined,
            storedOnlyBrowse: false,
          },
        }),
      )
    }

    const filters = toSearchFilters(parsed.data)
    const storedOnlyBrowse = isStoredOnlyBrowse(parsed.data)
    const exactLookup = classifyExactLookup(parsed.data.query)
    const recognisedCitation = exactLookup?.recognisedQuery ?? null
    const judgmentExactAttempted = !storedOnlyBrowse && exactLookup !== null
    const exactLookupToRun = !storedOnlyBrowse ? exactLookup : null
    const legislationOptions =
      !storedOnlyBrowse && !isJudgmentOnlyFetch(parsed.data)
        ? options.legislation
        : undefined
    const legislationAttempted = legislationOptions !== undefined
    const [judgmentExactHalf, legislationHalf] = await Promise.all([
      settleSearchHalf(
        exactLookupToRun
          ? findExactStoredAuthority(
              searchClient,
              reads,
              env.legalAuthoritiesIndex,
              parsed.data.query,
              filters,
              exactLookupToRun,
            )
          : Promise.resolve(null),
        requestId,
        'judgment_exact',
      ),
      settleSearchHalf(
        legislationOptions
          ? resolveLegislationFetch(
              {
                pool: legislationOptions.pool,
                searchClient,
                indexName: legislationOptions.indexName,
              },
              parsed.data.query,
            )
          : Promise.resolve(null),
        requestId,
        'legislation',
      ),
    ])
    const exactStoredAuthority =
      judgmentExactHalf.status === 'settled' ? judgmentExactHalf.value : null
    const legislation =
      legislationHalf.status === 'settled' ? legislationHalf.value : null
    const judgmentExactFailed =
      judgmentExactAttempted && judgmentExactHalf.status === 'failed'
    const legislationSearchFailed =
      legislationAttempted &&
      (legislationHalf.status === 'failed' || legislation?.failed === true)
    const legislationServed = legislationGroupsServed(legislation)

    const exactIndexUnavailable =
      exactStoredAuthority?.storedIndexStatus === 'unavailable'

    if (exactIndexUnavailable && !legislationServed) {
      return c.json(searchIndexUnavailable(requestId), 503)
    }

    let judgmentSearchFailed = judgmentExactFailed
    const exactLookupCompleted =
      exactLookup !== null && !judgmentExactFailed && !exactIndexUnavailable

    if (exactStoredAuthority?.hit) {
      const summaries = [
        toSummaryHit(exactStoredAuthority.hit, parsed.data.query, {
          retrievalPath: 'stored_exact_lookup',
          retrievalRank: 1,
          recognisedCitation,
        }),
      ]
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        summaries,
        legislation,
        !judgmentSearchFailed,
      )
      return c.json(
        toFetchResponse(summaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: exactLookupCompleted,
            storedIndexSearched: true,
            liveProviderSearched: false,
            foregroundLiveIgnored: foregroundLiveRequested || undefined,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation, {
              judgment: judgmentSearchFailed,
              legislation: legislationSearchFailed,
            }),
          },
        }),
      )
    }

    const cached = exactIndexUnavailable
      ? null
      : await searchStoredAuthorities(
          searchClient,
          env.legalAuthoritiesIndex,
          parsed.data.query,
          filters,
          {
            ...(storedOnlyBrowse
              ? { limit: storedCourtBrowseLimit }
              : { limit: storedIndexRerankPoolLimit }),
            ...(recognisedCitation ? { exactPhrase: recognisedCitation } : {}),
          },
        )

    const cachedIndexUnavailable =
      exactIndexUnavailable || cached?.storedIndexStatus === 'unavailable'
    const storedIndexCompleted = cached?.storedIndexStatus === 'ok'
    const visibleCachedHits =
      cached && cached.storedIndexStatus === 'ok'
        ? await excludeWithdrawnIndexHits(reads, cached.hits)
        : []
    judgmentSearchFailed = judgmentSearchFailed || cachedIndexUnavailable

    if (cachedIndexUnavailable && !legislationServed) {
      return c.json(searchIndexUnavailable(requestId), 503)
    }

    if (hasGoodStoredHits(visibleCachedHits, exactLookup)) {
      const summaries = visibleCachedHits
        .slice(0, servedStoredHitsLimit)
        .map((hit, index) =>
          toSummaryHit(hit, parsed.data.query, {
            retrievalPath: 'stored_index',
            retrievalRank: index + 1,
            recognisedCitation,
          }),
        )
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        summaries,
        legislation,
        !judgmentSearchFailed,
      )
      return c.json(
        toFetchResponse(summaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: exactLookupCompleted,
            storedIndexSearched: storedIndexCompleted,
            liveProviderSearched: false,
            foregroundLiveIgnored: foregroundLiveRequested || undefined,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation, {
              judgment: judgmentSearchFailed,
              legislation: legislationSearchFailed,
            }),
          },
        }),
      )
    }

    if (!parsed.data.query.trim()) {
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        [],
        legislation,
        !judgmentSearchFailed,
      )
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'stored_browse_empty',
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: exactLookupCompleted,
            storedIndexSearched: storedIndexCompleted,
            liveProviderSearched: false,
            foregroundLiveIgnored: foregroundLiveRequested || undefined,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation, {
              judgment: judgmentSearchFailed,
              legislation: legislationSearchFailed,
            }),
          },
        }),
      )
    }

    const citingLookup =
      !cachedIndexUnavailable && exactLookup && recognisedCitation
        ? await searchStoredAuthorities(
            searchClient,
            env.legalAuthoritiesIndex,
            parsed.data.query,
            filters,
            {
              exactPhrase: recognisedCitation,
              rankingScoreThreshold: null,
            },
          )
        : null
    const citingIndexUnavailable =
      citingLookup?.storedIndexStatus === 'unavailable'
    const visibleCitingHits =
      citingLookup && citingLookup.storedIndexStatus === 'ok'
        ? await excludeWithdrawnIndexHits(reads, citingLookup.hits)
        : []
    judgmentSearchFailed = judgmentSearchFailed || citingIndexUnavailable
    if (citingIndexUnavailable && !legislationServed) {
      return c.json(searchIndexUnavailable(requestId), 503)
    }
    const citingSummaries = await citingStoredSummariesForCitation(
      reads,
      visibleCitingHits,
      parsed.data.query,
      recognisedCitation,
    )
    if (exactLookup && citingSummaries.length > 0) {
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        citingSummaries,
        legislation,
        !judgmentSearchFailed,
      )
      return c.json(
        toFetchResponse(citingSummaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: exactLookupCompleted,
            storedIndexSearched: storedIndexCompleted,
            liveProviderSearched: false,
            foregroundLiveIgnored: foregroundLiveRequested || undefined,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation, {
              judgment: judgmentSearchFailed,
              legislation: legislationSearchFailed,
            }),
          },
        }),
      )
    }
    if (
      !legislationServed &&
      (judgmentSearchFailed || legislationSearchFailed)
    ) {
      return c.json(searchIncomplete(requestId), 503)
    }
    const { citation, citationDiagnostics } = citationFieldsWithLegislation(
      exactLookup,
      [],
      legislation,
      !judgmentSearchFailed,
    )
    return c.json(
      toFetchResponse([], parsed.data.query, true, 0, 0, false, {
        outcome:
          legislationEmptyOutcome(legislation) ??
          (exactLookup ? 'recognised_not_held' : 'no_match'),
        citation,
        ...legislationFetchExtras(exactLookup, legislation),
        diagnostics: {
          exactLookupSearched: exactLookupCompleted,
          storedIndexSearched: storedIndexCompleted,
          liveProviderSearched: false,
          foregroundLiveIgnored: foregroundLiveRequested || undefined,
          storedOnlyBrowse,
          ...citationDiagnostics,
          ...legislationDiagnosticsFor(legislation, {
            judgment: judgmentSearchFailed,
            legislation: legislationSearchFailed,
          }),
        },
      }),
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

    const storedLookup = await getDocumentRouteSourceRecord(reads, parsed.data)
    if (storedLookup.status === 'unavailable') {
      return c.json(
        apiError(
          'storage_unavailable',
          'Legal source storage is unavailable.',
          requestId,
        ),
        503,
      )
    }
    const storedSourceRecord = storedLookup.record
    if (storedSourceRecord?.withdrawn) {
      const { paragraphs: _paragraphs, ...metadata } =
        storedSourceRecord.summary
      return c.json({
        document: metadata,
        withdrawn: {
          withdrawn: true,
          withdrawnAt: storedSourceRecord.withdrawn.at,
          officialUrl: storedSourceRecord.summary.sourceUrl,
          message:
            'This judgment was withdrawn upstream by Find Case Law and is no longer published. Showing stored metadata only.',
        },
      })
    }

    const document = await getStoredAuthorityDocument(
      indexClient,
      env.legalAuthoritiesIndex,
      parsed.data,
    )

    const courtParagraphNumbers = hasCourtParagraphNumbers(storedSourceRecord)
    const acquiredAt = storedSourceRecord?.provider.acquiredAt ?? null
    const published = {
      judges: storedSourceRecord?.judges?.map((judge) => judge.name) ?? [],
      summary: storedSourceRecord?.publishedSummary
        ? {
            kind: 'press_summary',
            paragraphs: storedSourceRecord.publishedSummary.paragraphs,
            sourceUrl: storedSourceRecord.publishedSummary.sourceUrl,
          }
        : null,
    } satisfies {
      judges: string[]
      summary: CaseLawSummaryResponse | null
    }

    if (document) {
      return c.json({
        document,
        courtParagraphNumbers,
        acquiredAt,
        ...published,
      })
    }

    if (storedSourceRecord?.document) {
      return c.json({
        document: storedSourceRecord.document,
        courtParagraphNumbers,
        acquiredAt,
        ...published,
      })
    }

    if (storedSourceRecord?.summary) {
      return c.json({
        document: storedSourceRecord.summary,
        acquiredAt,
        ...published,
      })
    }

    return c.json(
      apiError(
        'document_not_found',
        'Document is not held in the local corpus.',
        requestId,
      ),
      404,
    )
  })

  app.get('/api/search/legislation/*', async (c) => {
    const requestId = c.get('requestId')
    if (!options.legislation) {
      return c.json(
        apiError(
          'document_not_found',
          'Legislation provision was not found.',
          requestId,
        ),
        404,
      )
    }
    const rest = c.req.path.replace(/^\/api\/search\/legislation\/?/, '')
    const parsed = parseLegislationProvisionPath(rest)
    if (parsed) {
      const result = await resolveLegislationProvisionPage(
        options.legislation.pool,
        parsed.provisionId,
      )
      if (result.status === 'unavailable') {
        return c.json(
          apiError(
            'storage_unavailable',
            'Legal source storage is unavailable.',
            requestId,
          ),
          503,
        )
      }
      if (result.status === 'not_found') {
        return c.json(
          apiError(
            'document_not_found',
            'Legislation provision was not found.',
            requestId,
          ),
          404,
        )
      }
      return c.json(result.page)
    }
    const actParsed = parseLegislationActPath(rest)
    if (!actParsed) {
      return c.json(
        apiError(
          'validation_failed',
          'Legislation path is invalid.',
          requestId,
        ),
        400,
      )
    }
    const actResult = await resolveLegislationActPage(
      options.legislation.pool,
      actParsed.documentIdentity,
    )
    if (actResult.status === 'unavailable') {
      return c.json(
        apiError(
          'storage_unavailable',
          'Legal source storage is unavailable.',
          requestId,
        ),
        503,
      )
    }
    if (actResult.status === 'not_found') {
      return c.json(
        apiError(
          'document_not_found',
          'Legislation Act was not found.',
          requestId,
        ),
        404,
      )
    }
    return c.json(actResult.page)
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
  return (
    !request.sourceType ||
    request.sourceType === 'judgment' ||
    request.sourceType === 'legislation_document' ||
    request.sourceType === 'legislation_provision'
  )
}

function isJudgmentOnlyFetch(request: LegalFetchRequest) {
  return request.sourceType === 'judgment'
}

function legislationGroupsServed(legislation: LegislationFetchResult | null) {
  return legislation?.groups.some((group) => group.hits.length > 0) ?? false
}

function legislationDiagnosticsFor(
  legislation: LegislationFetchResult | null,
  failures: { judgment: boolean; legislation: boolean },
) {
  return {
    ...(legislation
      ? {
          legislationSearched: legislation.searched && !legislation.failed,
          legislationGroupServed: legislationGroupsServed(legislation),
          ...(legislation.recognisedNotHeld
            ? { legislationNotHeld: true }
            : {}),
          ...(legislation.titleUnresolved
            ? { legislationTitleUnresolved: true }
            : {}),
          ...(legislation.ambiguous ? { legislationAmbiguous: true } : {}),
          ...(legislation.scheduleUnderspecified
            ? {
                legislationScheduleGuidance: legislation.scheduleUnderspecified,
              }
            : {}),
          ...(legislation.note ? { legislationNote: legislation.note } : {}),
          ...(legislation.keywordSearchParameters
            ? {
                legislationSearchParameters:
                  legislation.keywordSearchParameters,
              }
            : {}),
        }
      : {}),
    ...(failures.judgment ? { judgmentSearchFailed: true } : {}),
    ...(failures.legislation ? { legislationSearchFailed: true } : {}),
  }
}

function legislationEmptyOutcome(
  legislation: LegislationFetchResult | null,
): LegalFetchOutcome | null {
  if (!legislation) return null
  if (legislationGroupsServed(legislation)) return 'results'
  if (legislation.recognisedNotHeld) return 'recognised_not_held'
  if (legislation.titleUnresolved) return 'legislation_title_unresolved'
  if (legislation.ambiguous) return 'legislation_ambiguous'
  if (legislation.scheduleUnderspecified)
    return 'legislation_schedule_underspecified'
  return null
}

function legislationGroupsFor(legislation: LegislationFetchResult | null) {
  if (!legislation || legislation.groups.length === 0) return {}
  return { groups: legislation.groups }
}

function legislationLeadFor(
  exactLookup: ExactLookup | null,
  legislation: LegislationFetchResult | null,
) {
  if (exactLookup || !legislation?.citationRecognised) return {}
  return { primaryGroup: 'legislation' as const }
}

function legislationFetchExtras(
  exactLookup: ExactLookup | null,
  legislation: LegislationFetchResult | null,
) {
  return {
    ...legislationGroupsFor(legislation),
    ...legislationLeadFor(exactLookup, legislation),
  }
}

function citationFieldsWithLegislation(
  exactLookup: ExactLookup | null,
  servedHits: Array<Pick<LegalFetchSearchHit, 'citationMatch'>>,
  legislation: LegislationFetchResult | null,
  judgmentComplete: boolean,
) {
  const base = citationFields(exactLookup, servedHits, judgmentComplete)
  if (exactLookup || !legislation) return base
  if (legislation.citationHeldExact) {
    return {
      citation: { recognised: true, status: 'held_exact' as const },
      citationDiagnostics: {
        citationRecognised: true,
        citationStatus: 'held_exact' as const,
      },
    }
  }
  if (legislation.recognisedNotHeld) {
    return {
      citation: { recognised: true, status: 'not_held' as const },
      citationDiagnostics: {
        citationRecognised: true,
        citationStatus: 'not_held' as const,
      },
    }
  }
  return base
}

function searchIndexUnavailable(requestId: string) {
  return apiError(
    'search_unavailable',
    'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
    requestId,
  )
}

function searchIncomplete(requestId: string) {
  return apiError(
    'search_incomplete',
    'Legal search could not be completed because part of the search failed. Try again later.',
    requestId,
  )
}

type ExactLookup =
  | { kind: 'document_id'; normalizedQuery: string; recognisedQuery: string }
  | {
      kind: 'neutral_citation'
      normalizedQuery: string
      recognisedQuery: string
    }

function classifyExactLookup(query: string): ExactLookup | null {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return null

  if (isExactDocumentId(normalizedQuery)) {
    return {
      kind: 'document_id',
      normalizedQuery,
      recognisedQuery: query,
    }
  }

  const extractedCitation = extractNeutralCitation(query)
  if (
    extractedCitation &&
    normalizeSearchValue(extractedCitation) === normalizedQuery
  ) {
    return {
      kind: 'neutral_citation',
      normalizedQuery,
      recognisedQuery: extractedCitation,
    }
  }

  return null
}

async function findExactStoredAuthority(
  searchClient: Parameters<typeof search>[0],
  reads: LegalAuthorityReadStore,
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
    { limit: 5, exactPhrase: lookup.recognisedQuery },
  )
  const storedIndexStatus = storedIndexResult.storedIndexStatus
  if (storedIndexStatus === 'unavailable') {
    return { hit: null, storedIndexStatus }
  }
  const visibleIndexHits = await excludeWithdrawnIndexHits(
    reads,
    storedIndexResult.hits,
  )
  const storedIndexHit = visibleIndexHits.find((hit) =>
    isExactLookupHit(hit, lookup),
  )
  if (storedIndexHit) return { hit: storedIndexHit, storedIndexStatus }

  if (lookup.kind === 'document_id') {
    const storedRecord = await getLegalAuthoritySourceRecord(
      reads,
      lookup.normalizedQuery,
    )
    if (storedRecord && !storedRecord.withdrawn) {
      const storedDocument = storedRecord.document ?? storedRecord.summary
      if (storedDocument && sourceMatchesFilters(storedDocument, filters)) {
        return { hit: storedDocument, storedIndexStatus }
      }
    }
  }

  return { hit: null, storedIndexStatus }
}

function isExactDocumentId(normalizedQuery: string) {
  return (
    /^d-[a-z0-9-]+$/.test(normalizedQuery) ||
    /^[a-z][a-z0-9-]*(?:-[a-z0-9]+)*-\d{4}-\d+$/.test(normalizedQuery)
  )
}

function hasGoodStoredHits(
  hits: LegalFetchSearchHit[],
  exactLookup: ExactLookup | null,
) {
  if (!exactLookup) return hits.length > 0
  return hits.some((hit) => isExactLookupHit(hit, exactLookup))
}

async function citingStoredSummariesForCitation(
  reads: LegalAuthorityReadStore,
  indexHits: LegalFetchSearchHit[],
  query: string,
  recognisedCitation: string | null,
): Promise<LegalFetchSearchHit[]> {
  if (!recognisedCitation) return []
  const candidates = indexHits.map((hit, index) => ({
    hit,
    retrievalPath: 'stored_index' as const,
    retrievalRank: index + 1,
  }))
  const hydrated = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      hit: await withCitingBodyText(reads, candidate.hit),
    })),
  )
  const seen = new Set<string>()
  const citing: LegalFetchSearchHit[] = []
  for (const candidate of hydrated) {
    if (seen.has(candidate.hit.id)) continue
    seen.add(candidate.hit.id)
    if (
      !bodyCitesRecognisedCitation(
        candidate.hit.paragraphs,
        candidate.hit.snippets,
        recognisedCitation,
      )
    ) {
      continue
    }
    const summary = toSummaryHit(candidate.hit, query, {
      retrievalPath: candidate.retrievalPath,
      retrievalRank: citing.length + 1,
      recognisedCitation,
    })
    if (summary.citationMatch !== 'citing') continue
    citing.push(summary)
  }
  return citing
}

async function withCitingBodyText(
  reads: LegalAuthorityReadStore,
  hit: LegalFetchSearchHit,
): Promise<LegalFetchSearchHit> {
  if ((hit.paragraphs ?? []).length > 0) return hit
  const record = await getLegalAuthoritySourceRecord(reads, hit.id)
  if (!record || record.withdrawn) return hit
  const full = record.document ?? record.summary
  if (!full || (full.paragraphs ?? []).length === 0) return hit
  return { ...hit, paragraphs: full.paragraphs, snippets: undefined }
}

const citingPhrasePatterns = new Map<string, RegExp>()
const citingPhrasePatternLimit = 500

function bodyCitesRecognisedCitation(
  paragraphs: LegalFetchSearchHit['paragraphs'],
  snippets: LegalFetchSearchHit['snippets'],
  recognisedCitation: string,
): boolean {
  const normalizedCitation = normalizeExactMatchValue(recognisedCitation)
  if (!normalizedCitation) return false
  let pattern = citingPhrasePatterns.get(normalizedCitation)
  if (!pattern) {
    const escaped = normalizedCitation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`,
      'u',
    )
    citingPhrasePatterns.set(normalizedCitation, pattern)
    const oldest = citingPhrasePatterns.keys().next().value
    if (citingPhrasePatterns.size > citingPhrasePatternLimit && oldest) {
      citingPhrasePatterns.delete(oldest)
    }
  }
  const bodyText = [
    ...(paragraphs?.map((paragraph) => paragraph.text) ?? []),
    ...(snippets?.map((snippet) => snippet.text) ?? []),
  ].join('\n')
  if (!bodyText) return false
  return pattern.test(normalizeExactMatchValue(bodyText))
}

function citationFields(
  exactLookup: ExactLookup | null,
  servedHits: Array<Pick<LegalFetchSearchHit, 'citationMatch'>>,
  judgmentComplete = true,
) {
  const status: LegalSearchCitationStatus = !exactLookup
    ? 'not_citation'
    : servedHits.some((hit) => hit.citationMatch === 'exact')
      ? 'held_exact'
      : judgmentComplete
        ? 'not_held'
        : 'unverified'
  return {
    citation: { recognised: exactLookup !== null, status },
    citationDiagnostics: {
      citationRecognised: exactLookup !== null,
      citationStatus: status,
    },
  }
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

interface StoredSearchOptions {
  includeSnippets: boolean
  includeParagraphs: boolean
  limit?: number
  exactPhrase?: string
  rankingScoreThreshold?: number | null
}

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
  options: {
    limit?: number
    exactPhrase?: string
    rankingScoreThreshold?: number | null
  } = {},
): Promise<StoredAuthoritiesResult> {
  try {
    const searchOptions: StoredSearchOptions = {
      includeSnippets: false,
      includeParagraphs: true,
    }
    if (typeof options.limit === 'number') {
      searchOptions.limit = options.limit
    }
    if (options.exactPhrase) {
      searchOptions.exactPhrase = options.exactPhrase
    }
    if (options.rankingScoreThreshold !== undefined) {
      searchOptions.rankingScoreThreshold = options.rankingScoreThreshold
    }
    const result = await withTimeout(
      search(searchClient, indexName, query, filters, searchOptions),
      storedSearchTimeoutMs,
    )

    if (!result) {
      console.error(
        'Stored Meilisearch search timed out — serving 503 search_unavailable.',
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
        typeof options.limit === 'number'
          ? result.hits.slice(0, options.limit)
          : result.hits,
      storedIndexStatus: 'ok',
    }
  } catch (error: unknown) {
    console.error(
      'Stored Meilisearch search failed — serving 503 search_unavailable.',
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

async function getLegalAuthoritySourceRecord(
  reads: LegalAuthorityReadStore,
  documentId: string,
) {
  try {
    return await withTimeout(reads.get(documentId), storedSearchTimeoutMs)
  } catch {
    return null
  }
}

async function excludeWithdrawnIndexHits(
  reads: LegalAuthorityReadStore,
  hits: LegalSearchHit[],
): Promise<LegalSearchHit[]> {
  if (hits.length === 0) return hits
  const records = await Promise.all(
    hits.map((hit) => getLegalAuthoritySourceRecord(reads, hit.id)),
  )
  return hits.filter((_, index) => !records[index]?.withdrawn)
}

async function getDocumentRouteSourceRecord(
  reads: LegalAuthorityReadStore,
  documentId: string,
): Promise<
  | { status: 'ok'; record: StoredLegalAuthorityRecord | null }
  | { status: 'unavailable' }
> {
  const timedOut = Symbol('store-timeout')
  try {
    const record = await Promise.race([
      reads.get(documentId),
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), storedSearchTimeoutMs),
      ),
    ])
    if (record === timedOut) return { status: 'unavailable' }
    return { status: 'ok', record }
  } catch {
    return { status: 'unavailable' }
  }
}

function hasCourtParagraphNumbers(record: StoredLegalAuthorityRecord | null) {
  return record !== null && record.provider.rawDocumentHtml === undefined
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
export { createPostgresLegalAuthorityReadStore } from './source-store'
export type { LegalFetchSearchHit } from './response-utils'
