import { Hono } from 'hono'
import {
  createClient,
  normalizeExactMatchValue,
  rankLegalSearchHitsByExactMatch,
  search,
  type LegalSearchFilters,
  type LegalSearchHit,
} from '@obiter/search-client'
import type { ApiEnv } from '../../env'
import type { Pool } from 'pg'
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
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts'
import type { LegalSearchCitationStatus } from '@obiter/contracts'
import {
  apiError,
  toFetchResponse,
  toSummaryHit,
  type LegalFetchOutcome,
  type LegalFetchSearchHit,
} from './response-utils'
import {
  createInMemoryLegalAuthoritySourceStore,
  rememberForegroundSourceRecord,
  toAuthoritySummary,
  type LegalAuthoritySourceStore,
  type StoredLegalAuthorityRecord,
} from './source-store'
import { resolveLegislationActPage } from './legislation-act'
import {
  resolveLegislationFetch,
  resolveLegislationProvisionPage,
  type LegislationFetchResult,
} from './legislation-serve'
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
  /**
   * Stage 1 legislation serving. Absent in tests that predate it, in which
   * case fetch stays judgment-only and no legislation group is served.
   */
  legislation?: {
    pool: Pool
    indexName: string
  }
}

// Bounds every stored lookup: Meili pool fetch and Postgres withdrawn-record
// checks. Sized for a 100-hit paragraph pool (~1s measured worst case,
// ~690ms p50 on stored paths; held-citation phrase queries stay ~20-50ms);
// a slower engine fails visibly with 503 rather than holding the route open.
const storedSearchTimeoutMs = 2000
const storedCourtBrowseLimit = 10
/**
 * Engine candidates re-ranked per stored-index query. The engine cutoff used
 * to sit at its default 20, so the exact-match re-rank could only reorder
 * survivors and party-name targets the engine ranked 41-92 never surfaced.
 * Served responses stay capped below; the pool only feeds the re-rank.
 */
const storedIndexRerankPoolLimit = 100
/** Stored-index hits served per query; the suite measures the top 20. */
const servedStoredHitsLimit = 20

/**
 * A rejection in one search half must not reject the other. The judgment and
 * legislation corpora are federated precisely so each fails independently; an
 * unhandled rejection from either half used to lose both and 500 the request.
 * The failure is logged, not swallowed, and the half contributes no result.
 */
function settleSearchHalf<T>(
  promise: Promise<T>,
  requestId: string,
  half: string,
): Promise<T | null> {
  return promise.catch((error: unknown) => {
    console.error('Legal search half failed', {
      requestId,
      half,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })
}

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
            liveProviderSearched: false,
            storedOnlyBrowse: false,
          },
        }),
      )
    }

    const filters = toSearchFilters(parsed.data)
    const storedOnlyBrowse = isStoredOnlyBrowse(parsed.data)
    const exactLookup = classifyExactLookup(parsed.data.query)
    // Recognised citation surface form: the phrase the stored index searches
    // for and the label served hits carry. Null for every other query.
    const recognisedCitation = exactLookup?.recognisedQuery ?? null
    // Stage 1 legislation half: Postgres exact answers plus a labelled
    // keyword group, federated after the judgment flat hits. Skipped only
    // when the caller narrows to judgments or the route was built without
    // a legislation store (older tests). Never touches the judgment flow.
    // Started without awaiting so it runs concurrently with the judgment
    // lookups below: a slow legislation store (2s fail-open) must not hold
    // the judgment half open. Every return path awaits it before responding.
    const legislationPromise =
      !storedOnlyBrowse &&
      !isJudgmentOnlyFetch(parsed.data) &&
      options.legislation
        ? resolveLegislationFetch(
            {
              pool: options.legislation.pool,
              searchClient,
              indexName: options.legislation.indexName,
            },
            parsed.data.query,
          )
        : Promise.resolve(null)
    const exactStoredAuthorityPromise =
      !storedOnlyBrowse && exactLookup
        ? findExactStoredAuthority(
            searchClient,
            legalAuthorityStore,
            env.legalAuthoritiesIndex,
            parsed.data.query,
            filters,
            exactLookup,
          )
        : Promise.resolve(null)
    // Overlap the two halves: neither holds the other open beyond its own
    // 2s fail-open bounds, and one half's failure cannot take the other down.
    const [exactStoredAuthority, legislation] = await Promise.all([
      settleSearchHalf(
        exactStoredAuthorityPromise,
        requestId,
        'judgment_exact',
      ),
      settleSearchHalf(legislationPromise, requestId, 'legislation'),
    ])

    // Meilisearch is the sole query engine: without it there is nothing to
    // rank or verify against, so the outage fails visibly instead of
    // degrading to a differently-ranked second engine.
    if (exactStoredAuthority?.storedIndexStatus === 'unavailable') {
      return c.json(searchIndexUnavailable(requestId), 503)
    }

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
      )
      return c.json(
        toFetchResponse(summaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: true,
            storedIndexSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
          },
        }),
      )
    }

    const cached = await searchStoredAuthorities(
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

    // The derived index lags the checker: filter Meili hits against the
    // Postgres withdrawn flag before responding, so a stale indexed copy of
    // a withdrawn judgment never serves. Unknown (lookup miss/timeout)
    // stays visible — only an explicit withdrawn flag hides a hit.
    const visibleCachedHits = await excludeWithdrawnIndexHits(
      legalAuthorityStore,
      cached.hits,
    )

    if (cached.storedIndexStatus === 'unavailable') {
      return c.json(searchIndexUnavailable(requestId), 503)
    }

    // Honesty gate: a recognised citation is only found when a visible hit
    // IS that citation. Keyword neighbours that merely mention it are citing
    // cases, not the judgment, so they fall through to live instead of
    // suppressing it. Any visible hit still satisfies other queries.
    if (hasGoodStoredHits(visibleCachedHits, exactLookup)) {
      // search() already re-ranked the pool; serve the top page of it.
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
      )
      return c.json(
        toFetchResponse(summaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
          },
        }),
      )
    }

    if (!parsed.data.query.trim()) {
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        [],
        legislation,
      )
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome: 'stored_browse_empty',
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
          },
        }),
      )
    }

    const sessionUser = c.get('user') ?? null

    if (!sessionUser) {
      // Anonymous stays stored-only (30-Aug decision): no live call. A
      // recognised citation with no exact stored hit is honestly not held —
      // but stored judgments that cite it are still served, labelled by
      // their citationMatch, so the answer reads as not-held-with-citing
      // rather than a silent no-match. Candidates prove the citation with
      // full paragraph text (hydrated where the index serves summaries)
      // against a bounded phrase, so keyword neighbours stay excluded even
      // when scattered terms co-occur.
      //
      // The ranked search above carries the relevance floor, which starves
      // exact-phrase citation lookups once sort is applied (measured: the
      // [2003] UKHL 1 phrase matches ten citing judgments unfiltered and
      // zero with the floor). The citing lookup below repeats the same
      // phrase without the floor; matchingStrategy is untouched, and the
      // floor still gates every ranked result. Precision comes from the
      // phrase plus the bounded-phrase body check, not the score.
      const citingLookup =
        exactLookup && recognisedCitation
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
      if (citingLookup?.storedIndexStatus === 'unavailable') {
        return c.json(searchIndexUnavailable(requestId), 503)
      }
      const visibleCitingHits = citingLookup
        ? await excludeWithdrawnIndexHits(
            legalAuthorityStore,
            citingLookup.hits,
          )
        : []
      const citingSummaries = await citingStoredSummariesForCitation(
        legalAuthorityStore,
        visibleCitingHits,
        parsed.data.query,
        recognisedCitation,
      )
      if (exactLookup && citingSummaries.length > 0) {
        const { citation, citationDiagnostics } = citationFieldsWithLegislation(
          exactLookup,
          citingSummaries,
          legislation,
        )
        return c.json(
          toFetchResponse(
            citingSummaries,
            parsed.data.query,
            true,
            0,
            0,
            false,
            {
              citation,
              ...legislationFetchExtras(exactLookup, legislation),
              diagnostics: {
                exactLookupSearched: true,
                storedIndexSearched: true,
                liveProviderSearched: false,
                storedOnlyBrowse,
                ...citationDiagnostics,
                ...legislationDiagnosticsFor(legislation),
              },
            },
          ),
        )
      }
      // Anonymous stays stored-only (30-Aug decision): a recognised citation
      // with no exact stored hit and no stored citing case is honestly not
      // held, not a silent no-match.
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        [],
        legislation,
      )
      return c.json(
        toFetchResponse([], parsed.data.query, true, 0, 0, false, {
          outcome:
            legislationEmptyOutcome(legislation) ??
            (exactLookup ? 'recognised_not_held' : 'no_match'),
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
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
      // The transport lifecycle and the legislation diagnostic are separate
      // fields here. A job is genuinely pending, so the top-level outcome must
      // stay hydration_queued or the client stops polling, spends the
      // hydration budget and silently discards whatever the job later indexes.
      // The legislation verdict rides diagnostics and drives the copy while
      // the poll runs; once the job lands, the stored search above serves the
      // hydrated judgments before this branch is reached.
      const { citation, citationDiagnostics } = citationFieldsWithLegislation(
        exactLookup,
        [],
        legislation,
      )
      return c.json(
        toFetchResponse([], parsed.data.query, false, 0, 0, true, {
          outcome: 'hydration_queued',
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            liveProviderSearched: false,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
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
      const summary = atomEntryToAuthoritySummary(env, entry)
      const provider = providerMetadataFromAtomEntry(entry)
      // Never re-index a withdrawn judgment from live hydration: the
      // checker owns the flag and only the manual runbook clears it.
      const existing = await getLegalAuthoritySourceRecord(
        legalAuthorityStore,
        summary.id,
      )
      if (existing?.withdrawn) continue
      rememberForegroundSourceRecord(foregroundSourceRecords, summary, provider)
      await upsertLegalAuthoritySummary(legalAuthorityStore, summary, provider)
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
    const liveSummaries = rankedLiveDocuments.map((hit, index) =>
      toSummaryHit(hit, parsed.data.query, {
        retrievalPath: 'live_provider',
        retrievalRank: index + 1,
        recognisedCitation,
      }),
    )
    const { citation, citationDiagnostics } = citationFieldsWithLegislation(
      exactLookup,
      liveSummaries,
      legislation,
    )

    // Foreground live was actually consulted, so an empty live set is an
    // answer, not a queue position: hydrationQueued stays true only while
    // there are live hits still being indexed in the background. A query
    // with nothing live and nothing stored is no_match (or
    // recognised_not_held for a citation), never hydration_queued, so it
    // cannot poll forever. The background path below keeps hydration_queued
    // because it has not consulted live yet; the UI bounds that poll.
    const liveHasHits = liveSummaries.length > 0
    return c.json(
      toFetchResponse(
        liveSummaries,
        parsed.data.query,
        false,
        0,
        liveResult.skippedCount,
        liveHasHits,
        {
          // A recognised citation live finds nothing for is not a silent
          // no-match; live hits without the exact judgment stay results
          // labelled by their citationMatch, with status not_held. A
          // legislation verdict rides the same empty answer: the judgment
          // half must not overwrite it with a generic no_match.
          outcome: liveHasHits
            ? undefined
            : (legislationEmptyOutcome(legislation) ??
              (exactLookup ? 'recognised_not_held' : 'no_match')),
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: Boolean(exactLookup),
            storedIndexSearched: true,
            liveProviderSearched: true,
            storedOnlyBrowse,
            ...citationDiagnostics,
            ...legislationDiagnosticsFor(legislation),
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

    // Fail closed: an unknown store state (timeout/error) must not fall
    // through to the derived index, which could serve a stale full text of
    // a withdrawn judgment. Only a confirmed store miss continues.
    const storedLookup = await getDocumentRouteSourceRecord(
      legalAuthorityStore,
      parsed.data,
    )
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
    // Postgres is the record: a withdrawn row stays stored but marked, so
    // direct fetch returns 200 with metadata and a banner, never 404 and
    // never full text. Checked before the derived index because a rebuild
    // may not have dropped the copy yet.
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

    if (document) {
      return c.json({ document })
    }

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
      // Re-check before caching: the row may have been marked withdrawn
      // between the route-entry lookup and the live fetch. A withdrawn row
      // answers with the banner, never with fresh full text.
      const currentRecord = await getLegalAuthoritySourceRecord(
        legalAuthorityStore,
        liveDocument.document.id,
      )
      if (currentRecord?.withdrawn) {
        const { paragraphs: _paragraphs, ...metadata } = currentRecord.summary
        return c.json({
          document: metadata,
          withdrawn: {
            withdrawn: true,
            withdrawnAt: currentRecord.withdrawn.at,
            officialUrl: currentRecord.summary.sourceUrl,
            message:
              'This judgment was withdrawn upstream by Find Case Law and is no longer published. Showing stored metadata only.',
          },
        })
      }
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

/** A caller that narrows to judgments opts out of the legislation group. */
function isJudgmentOnlyFetch(request: LegalFetchRequest) {
  return request.sourceType === 'judgment'
}

/**
 * Merges the legislation half into a judgment-half response. Groups ride
 * along on every site so the flat judgment hits array is byte-identical
 * with or without legislation; outcome flips to results only when the
 * legislation half actually served hits into an otherwise empty answer.
 */
function legislationGroupsServed(legislation: LegislationFetchResult | null) {
  return legislation?.groups.some((group) => group.hits.length > 0) ?? false
}

/** Spread into a site diagnostics literal. Empty when legislation is off. */
function legislationDiagnosticsFor(legislation: LegislationFetchResult | null) {
  if (!legislation) return {}
  return {
    legislationSearched: legislation.searched,
    legislationGroupServed: legislationGroupsServed(legislation),
    // A verdict, not an outage: the note alone cannot distinguish "the corpus
    // does not hold this" from "the store did not answer".
    ...(legislation.recognisedNotHeld ? { legislationNotHeld: true } : {}),
    // A whole-title request no exact key matched, or a title two stored Acts
    // satisfy. Neither is a not-held verdict, so each rides its own flag and
    // the page can say only what is known.
    ...(legislation.titleUnresolved
      ? { legislationTitleUnresolved: true }
      : {}),
    ...(legislation.ambiguous ? { legislationAmbiguous: true } : {}),
    // A held Act whose schedule citation names no schedule: a corrective
    // prompt, not a verdict. The structured example and Act context let the
    // client offer a resubmission the parser accepts.
    ...(legislation.scheduleUnderspecified
      ? { legislationScheduleGuidance: legislation.scheduleUnderspecified }
      : {}),
    ...(legislation.note ? { legislationNote: legislation.note } : {}),
    // The parameters this server sent to the engine on this response. Emitted
    // by the layer that applied them, not by the caller's configuration, so a
    // measurement records observed conditions. Omitted when no keyword search
    // ran (an exact Act or provision answer, an ambiguous query).
    ...(legislation.keywordSearchParameters
      ? { legislationSearchParameters: legislation.keywordSearchParameters }
      : {}),
  }
}

/**
 * The most specific legislation terminal for an otherwise empty answer. Used
 * by every terminal no-judgment branch so the judgment half's generic
 * `no_match` never overwrites a legislation verdict. `null` means the
 * legislation half has no claim, and the caller's judgment-side outcome
 * stands.
 */
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

/** Spread into a toFetchResponse options literal. Empty when no group. */
function legislationGroupsFor(legislation: LegislationFetchResult | null) {
  if (!legislation || legislation.groups.length === 0) return {}
  return { groups: legislation.groups }
}

/**
 * Statute-shaped queries (the API already classified them) lead with
 * legislation. Judgment citations and keyword queries stay judgment-led.
 * Omitted on judgment-led answers so existing clients keep the same JSON.
 */
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

/**
 * Citation honesty with the legislation half: a judgment citation keeps its
 * existing verdict; otherwise a held legislation exact wins held_exact and
 * a recognised-but-unheld one wins not_held. Never overrides a judgment
 * exactLookup, so judgment benchmarks read byte-identical fields.
 */
function citationFieldsWithLegislation(
  exactLookup: ExactLookup | null,
  servedHits: Array<Pick<LegalFetchSearchHit, 'citationMatch'>>,
  legislation: LegislationFetchResult | null,
) {
  const base = citationFields(exactLookup, servedHits)
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

/**
 * Visible 503 when Meilisearch cannot be reached. The engine is the sole
 * query layer, so its outage is search's outage: a named error the UI can
 * quote, never an empty result set standing in for a failure.
 */
function searchIndexUnavailable(requestId: string) {
  return apiError(
    'search_unavailable',
    'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.',
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
    { limit: 5, exactPhrase: lookup.recognisedQuery },
  )
  const storedIndexStatus = storedIndexResult.storedIndexStatus
  // No engine, no exact lookup: the handler turns this into a visible 503
  // rather than answering from a differently-ranked second engine.
  if (storedIndexStatus === 'unavailable') {
    return { hit: null, storedIndexStatus }
  }
  // Same stale-index guard as the main search path: an exact Meili hit for
  // a withdrawn row is dropped here, and direct fetch owns the banner.
  const visibleIndexHits = await excludeWithdrawnIndexHits(
    legalAuthorityStore,
    storedIndexResult.hits,
  )
  const storedIndexHit = visibleIndexHits.find((hit) =>
    isExactLookupHit(hit, lookup),
  )
  if (storedIndexHit) return { hit: storedIndexHit, storedIndexStatus }

  // A document id names its row directly, so the record itself answers when
  // the index lags. Citation-to-id resolution needs the engine and stays
  // above: without it there is nothing exact to serve.
  if (lookup.kind === 'document_id') {
    const storedRecord = await getLegalAuthoritySourceRecord(
      legalAuthorityStore,
      lookup.normalizedQuery,
    )
    // Withdrawn rows never surface in search, even on an exact id lookup:
    // direct fetch owns the banner response.
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

/**
 * Honesty gate for the stored early returns. A recognised citation is only
 * found when a visible hit IS that citation (exact id or neutral citation);
 * keyword neighbours that merely mention it are citing cases, not the
 * judgment, and must not suppress live. Every other query keeps the
 * any-hit rule. The 0.25 engine floor stays inside search(), not here.
 */
function hasGoodStoredHits(
  hits: LegalFetchSearchHit[],
  exactLookup: ExactLookup | null,
) {
  if (!exactLookup) return hits.length > 0
  return hits.some((hit) => isExactLookupHit(hit, exactLookup))
}

/**
 * Stored-only citing set for an anonymous recognised-citation query. Index
 * hits arrive as summaries (paragraphs stripped) carrying short excerpts,
 * which cannot prove a citation either way, so candidates without paragraph
 * text are hydrated from the record store before labelling. Only documents
 * whose body carries the citation as a bounded phrase serve. Exact hits
 * cannot reach here (the gates above return them), and the phrase check
 * keeps keyword neighbours out, so an invented citation with no citing
 * cases honestly serves nothing.
 */
async function citingStoredSummariesForCitation(
  legalAuthorityStore: LegalAuthoritySourceStore,
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
      hit: await withCitingBodyText(legalAuthorityStore, candidate.hit),
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

/**
 * Paragraph text for the citing check. Hits that already carry paragraphs
 * pass through; summaries are hydrated from the source store so the phrase
 * check reads full body text rather than excerpt windows. Unresolvable and
 * withdrawn records stay as they are and fail the check below — a candidate
 * that cannot prove the citation never serves. Snippets are dropped on
 * hydration so the served summary re-extracts excerpts from the full text.
 */
async function withCitingBodyText(
  legalAuthorityStore: LegalAuthoritySourceStore,
  hit: LegalFetchSearchHit,
): Promise<LegalFetchSearchHit> {
  if ((hit.paragraphs ?? []).length > 0) return hit
  const record = await getLegalAuthoritySourceRecord(
    legalAuthorityStore,
    hit.id,
  )
  if (!record || record.withdrawn) return hit
  const full = record.document ?? record.summary
  if (!full || (full.paragraphs ?? []).length === 0) return hit
  return { ...hit, paragraphs: full.paragraphs, snippets: undefined }
}

const citingPhrasePatterns = new Map<string, RegExp>()
const citingPhrasePatternLimit = 500

/**
 * True citing test: the recognised citation as a bounded phrase in body
 * text, not its terms scattered across a judgment. A neighbour that merely
 * mentions the court, the year, and some other number fails; a judgment
 * quoting the citation passes. Boundaries use the same word class as the
 * engine's whole-term matching so `[2003] UKHL 1` never matches
 * `[2003] UKHL 17`.
 */
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

/**
 * Citation honesty for a served set: held when a served hit is the exact
 * judgment, not held when the citation is recognised but none is, and not
 * a citation question at all otherwise. Read from served citationMatch
 * labels so status and labels cannot disagree.
 */
function citationFields(
  exactLookup: ExactLookup | null,
  servedHits: Array<Pick<LegalFetchSearchHit, 'citationMatch'>>,
) {
  const status: LegalSearchCitationStatus = !exactLookup
    ? 'not_citation'
    : servedHits.some((hit) => hit.citationMatch === 'exact')
      ? 'held_exact'
      : 'not_held'
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
  // A stored-index failure is reported, not swallowed: the caller turns
  // storedIndexStatus into a visible 503 so a broken engine never reads as
  // "no results". Only the error message is logged — RULES.md forbids
  // secrets in logs, so the provider cause is never serialised.
  try {
    // A recognised citation searches as an exact phrase so an absent
    // citation finds nothing instead of keyword neighbours.
    // Paragraphs without snippets: body tiers need the text, but snippet
    // extraction over a 100-hit pool costs ~1s of normalising (measured
    // 890ms vs 1634ms for Arch Insurance). Served hits get snippets lazily
    // from toSummaryHit, so the pool pays for text transfer and parse only.
    const searchOptions: {
      includeSnippets: boolean
      includeParagraphs: boolean
      limit?: number
      exactPhrase?: string
      rankingScoreThreshold?: number | null
    } = { includeSnippets: false, includeParagraphs: true }
    if (typeof options.limit === 'number') {
      searchOptions.limit = options.limit
    }
    if (options.exactPhrase) {
      searchOptions.exactPhrase = options.exactPhrase
    }
    // Opt-in only: every other caller sends the tuned floor by omission.
    // The anonymous citing lookup passes null to repeat its exact phrase
    // without the relevance floor.
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

/**
 * Cross-checks derived-index hits against the Postgres withdrawn flag.
 * Only an explicit flag hides a hit; a lookup miss, timeout, or error
 * keeps it visible so a transient store wobble cannot blank search.
 */
async function excludeWithdrawnIndexHits(
  legalAuthorityStore: LegalAuthoritySourceStore,
  hits: LegalSearchHit[],
): Promise<LegalSearchHit[]> {
  if (hits.length === 0) return hits
  const records = await Promise.all(
    hits.map((hit) =>
      getLegalAuthoritySourceRecord(legalAuthorityStore, hit.id),
    ),
  )
  return hits.filter((_, index) => !records[index]?.withdrawn)
}

/**
 * Document-route store lookup that distinguishes "row absent" (continue to
 * the derived index) from "store unknown" (fail closed with 503). The
 * plain helper above conflates both as null, which is fine for
 * withdrawn-filtering but would serve stale indexed full text on the
 * document route.
 */
async function getDocumentRouteSourceRecord(
  legalAuthorityStore: LegalAuthoritySourceStore,
  documentId: string,
): Promise<
  | { status: 'ok'; record: StoredLegalAuthorityRecord | null }
  | { status: 'unavailable' }
> {
  const timedOut = Symbol('store-timeout')
  try {
    const record = await Promise.race([
      legalAuthorityStore.get(documentId),
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
