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
 * The failure is logged, not swallowed, and the half reports a failure marker
 * so a crash is never mistaken for "not attempted" or for a clean empty.
 */
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
  // Corpus-only boundary: these routes read Obiter-owned records and the
  // derived index only. They never construct a Find Case Law client, never
  // queue hydration, and never retry an upstream request. National Archives
  // access belongs to an explicit indexing run, not to a user request.
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

    // The request flag is retained so an older desktop or web client is not
    // rejected, but the API is corpus-only: no live provider search runs. The
    // diagnostic below says so explicitly instead of leaving the client to
    // infer it from liveProviderSearched.
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
    const judgmentExactAttempted = !storedOnlyBrowse && exactLookup !== null
    const exactLookupToRun = !storedOnlyBrowse ? exactLookup : null
    const legislationOptions =
      !storedOnlyBrowse && !isJudgmentOnlyFetch(parsed.data)
        ? options.legislation
        : undefined
    const legislationAttempted = legislationOptions !== undefined
    // Overlap the two halves: neither holds the other open beyond its own
    // 2s fail-open bounds, and one half's failure cannot take the other down.
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

    // Meilisearch is the sole judgment query engine. Its outage is normally
    // the whole answer, but a legislation half that already answered from
    // Postgres must keep its hits: the corpora are federated so neither
    // failure discards the other's results.
    const exactIndexUnavailable =
      exactStoredAuthority?.storedIndexStatus === 'unavailable'

    if (exactIndexUnavailable && !legislationServed) {
      return c.json(searchIndexUnavailable(requestId), 503)
    }

    // Folds every later judgment-side outage into one failure flag. The exact
    // hit branch below raises it only for a rejected exact half; the stored
    // and citing lookups raise it after their own engine calls.
    let judgmentSearchFailed = judgmentExactFailed

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
    // The derived index lags the checker: filter Meili hits against the
    // Postgres withdrawn flag before responding, so a stale indexed copy of
    // a withdrawn judgment never serves. Unknown (lookup miss/timeout)
    // stays visible — only an explicit withdrawn flag hides a hit.
    const visibleCachedHits =
      cached && cached.storedIndexStatus === 'ok'
        ? await excludeWithdrawnIndexHits(reads, cached.hits)
        : []
    judgmentSearchFailed = judgmentSearchFailed || cachedIndexUnavailable

    // A judgment-side engine outage is the whole answer only when nothing
    // else answered. A legislation half already served from Postgres keeps
    // its hits and is marked incomplete below instead of being discarded.
    if (cachedIndexUnavailable && !legislationServed) {
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

    // Corpus-only: there is no live call. A
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
      )
      return c.json(
        toFetchResponse(citingSummaries, parsed.data.query, true, 0, 0, false, {
          citation,
          ...legislationFetchExtras(exactLookup, legislation),
          diagnostics: {
            exactLookupSearched: true,
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
    // A leg that failed cannot be reported as a completed verdict. With no
    // usable hit from either half the whole request is untrustworthy, so it
    // answers an explicit incomplete error instead of no_match or
    // recognised_not_held.
    if (
      !legislationServed &&
      (judgmentSearchFailed || legislationSearchFailed)
    ) {
      return c.json(searchIncomplete(requestId), 503)
    }
    // Corpus-only: a recognised citation
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

    // Fail closed: an unknown store state (timeout/error) must not fall
    // through to the derived index, which could serve a stale full text of
    // a withdrawn judgment. Only a confirmed store miss continues.
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

    if (storedSourceRecord?.document) {
      return c.json({ document: storedSourceRecord.document })
    }

    // Corpus-only: there is no provider fallback. A stored summary with no
    // full text (a PDF-only judgment) is still held locally, so serve its
    // metadata rather than answering not-found or reaching Find Case Law.
    // The case view renders the stored metadata alongside its "full text
    // unavailable" state, so nothing is invented and nothing is fetched.
    if (storedSourceRecord?.summary) {
      return c.json({ document: storedSourceRecord.summary })
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

/**
 * Spread into a site diagnostics literal. Empty when legislation is off.
 * `failures` names a half that did not complete, so the response never reads
 * as a clean verdict and the client can show incomplete coverage.
 */
function legislationDiagnosticsFor(
  legislation: LegislationFetchResult | null,
  failures: { judgment: boolean; legislation: boolean },
) {
  return {
    ...(legislation
      ? {
          // A failed leg never reads as searched, even where the attempt
          // began: `legislationSearchFailed` carries the truth instead.
          legislationSearched: legislation.searched && !legislation.failed,
          legislationGroupServed: legislationGroupsServed(legislation),
          // A verdict, not an outage: the note alone cannot distinguish "the
          // corpus does not hold this" from "the store did not answer".
          ...(legislation.recognisedNotHeld
            ? { legislationNotHeld: true }
            : {}),
          // A whole-title request no exact key matched, or a title two stored
          // Acts satisfy. Neither is a not-held verdict, so each rides its own
          // flag and the page can say only what is known.
          ...(legislation.titleUnresolved
            ? { legislationTitleUnresolved: true }
            : {}),
          ...(legislation.ambiguous ? { legislationAmbiguous: true } : {}),
          // A held Act whose schedule citation names no schedule: a corrective
          // prompt, not a verdict. The structured example and Act context let
          // the client offer a resubmission the parser accepts.
          ...(legislation.scheduleUnderspecified
            ? {
                legislationScheduleGuidance: legislation.scheduleUnderspecified,
              }
            : {}),
          ...(legislation.note ? { legislationNote: legislation.note } : {}),
          // The parameters this server sent to the engine on this response.
          // Emitted by the layer that applied them, not by the caller's
          // configuration, so a measurement records observed conditions.
          // Omitted when no keyword search ran (an exact Act or provision
          // answer, an ambiguous query).
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

/**
 * Visible 503 when a federated half failed and the other half had no usable
 * hit. Distinct from the index outage above: the engine may answer and only
 * the legislation or exact-lookup half failed, so a `no_match` here would
 * assert a negative the request never established.
 */
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
  // No engine, no exact lookup: the handler turns this into a visible 503
  // rather than answering from a differently-ranked second engine.
  if (storedIndexStatus === 'unavailable') {
    return { hit: null, storedIndexStatus }
  }
  // Same stale-index guard as the main search path: an exact Meili hit for
  // a withdrawn row is dropped here, and direct fetch owns the banner.
  const visibleIndexHits = await excludeWithdrawnIndexHits(
    reads,
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
      reads,
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

/**
 * Paragraph text for the citing check. Hits that already carry paragraphs
 * pass through; summaries are hydrated from the source store so the phrase
 * check reads full body text rather than excerpt windows. Unresolvable and
 * withdrawn records stay as they are and fail the check below — a candidate
 * that cannot prove the citation never serves. Snippets are dropped on
 * hydration so the served summary re-extracts excerpts from the full text.
 */
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
  reads: LegalAuthorityReadStore,
  documentId: string,
) {
  try {
    return await withTimeout(reads.get(documentId), storedSearchTimeoutMs)
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
  reads: LegalAuthorityReadStore,
  hits: LegalSearchHit[],
): Promise<LegalSearchHit[]> {
  if (hits.length === 0) return hits
  const records = await Promise.all(
    hits.map((hit) => getLegalAuthoritySourceRecord(reads, hit.id)),
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
export {
  createPostgresLegalAuthorityReadStore,
  createPostgresLegalAuthoritySourceStore,
  createPostgresLegalAuthorityWriteStore,
} from './source-store'
export type { LegalFetchSearchHit } from './response-utils'
