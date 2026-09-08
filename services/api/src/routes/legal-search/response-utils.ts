import {
  createCanonicalCasePath,
  type ApiErrorResponse,
  type LegalSearchCitation,
  type LegalSearchCitationMatch,
  type LegalSearchCitationStatus,
} from '@obiter/contracts'
import type { LegalAuthority } from '@obiter/legal-schema'
import {
  containsEveryQueryTerm,
  containsWholeTerm,
  createJudgmentParagraphEvidenceId,
  extractLegalSearchSnippets,
  normalizeCitationValue,
  normalizeExactMatchValue,
  titleContainsAnySearchableQueryTerm,
  titleContainsEveryQueryTerm,
  type LegalSearchHit,
  type LegalSearchMatchReason,
  type LegalSearchSnippet,
} from '@obiter/search-client'

export type LegalFetchRetrievalPath =
  'stored_exact_lookup' | 'stored_index' | 'stored_source' | 'live_provider'
export type LegalFetchOutcome =
  | 'results'
  | 'no_match'
  | 'hydration_queued'
  | 'stored_browse_empty'
  | 'unsupported_source_type'
  | 'recognised_not_held'
export interface LegalFetchSearchHit extends LegalSearchHit {
  canonicalUrl?: string
  evidenceIds?: string[]
  matchReason?: LegalSearchMatchReason
  /** Relation to the recognised citation; absent unless the query was one. */
  citationMatch?: LegalSearchCitationMatch
  retrievalPath?: LegalFetchRetrievalPath
  retrievalRank?: number
  retrievalScore?: number
  paragraphs?: LegalAuthority['paragraphs']
}
export function apiError(
  code: ApiErrorResponse['error']['code'],
  message: string,
  requestId: string,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
    },
  }
}
export function toFetchResponse(
  hits: LegalFetchSearchHit[],
  query: string,
  cached: boolean,
  indexedCount: number,
  skippedCount: number,
  hydrationQueued = false,
  options: {
    outcome?: LegalFetchOutcome
    /** Citation honesty; omitted entirely unless the caller passes it. */
    citation?: LegalSearchCitation
    diagnostics?: {
      exactLookupSearched?: boolean
      storedIndexSearched?: boolean
      storedSourceSearched?: boolean
      liveProviderSearched?: boolean
      storedOnlyBrowse?: boolean
      citationRecognised?: boolean
      citationStatus?: LegalSearchCitationStatus
      /** Present only when the stored Meilisearch index was consulted.
       * 'unavailable' means it timed out or errored and the Postgres
       * fallback carried the request — a miss reads 'ok' with no hits. */
      storedIndexStatus?: 'ok' | 'unavailable'
    }
  } = {},
) {
  const outcome = options.outcome ?? inferFetchOutcome(hits, hydrationQueued)

  return {
    hits,
    query,
    estimatedTotalHits: hits.length,
    processingTimeMs: 0,
    cached,
    indexedCount,
    skippedCount,
    hydrationQueued,
    outcome,
    // Undefined serialises away, so non-citation callers send no new key.
    citation: options.citation,
    diagnostics: options.diagnostics,
  }
}

export function toSummaryHit(
  hit: LegalSearchHit,
  query = '',
  options: {
    retrievalPath?: LegalFetchRetrievalPath
    retrievalRank?: number
    /** Recognised citation surface form; labels the hit, never gates it. */
    recognisedCitation?: string | null
  } = {},
): LegalFetchSearchHit {
  const snippets = hit.snippets ?? extractLegalSearchSnippets(hit, query)
  const matchReason = getLegalSearchMatchReason(hit, query, snippets.length > 0)
  const citationMatch = getCitationMatch(
    hit,
    options.recognisedCitation ?? null,
    matchReason,
    snippets,
  )
  const evidenceIds =
    snippets.length > 0
      ? snippets.map((snippet) => snippet.evidenceId)
      : [createJudgmentParagraphEvidenceId(hit.id, 1)]

  return {
    id: hit.id,
    title: hit.title,
    neutralCitation: hit.neutralCitation,
    court: hit.court,
    jurisdiction: hit.jurisdiction,
    dateDecided: hit.dateDecided,
    sourceType: hit.sourceType,
    sourceUrl: hit.sourceUrl,
    canonicalUrl: createCanonicalCasePath(hit),
    evidenceIds,
    matchReason,
    citationMatch,
    retrievalPath: options.retrievalPath,
    retrievalRank: options.retrievalRank,
    retrievalScore: scoreLegalSearchMatch(matchReason),
    snippets,
  }
}

function getLegalSearchMatchReason(
  hit: LegalSearchHit,
  query: string,
  hasSnippetMatch: boolean,
): LegalSearchMatchReason {
  const normalizedQuery = normalizeExactMatchValue(query)
  if (!normalizedQuery) return 'keyword_match'
  if (normalizeExactMatchValue(hit.id) === normalizedQuery)
    return 'exact_document_id'
  if (
    normalizeCitationValue(hit.neutralCitation) ===
    normalizeCitationValue(normalizedQuery)
  )
    return 'exact_neutral_citation'

  const normalizedTitle = normalizeExactMatchValue(hit.title)
  if (
    normalizedTitle === normalizedQuery ||
    containsWholeTerm(normalizedTitle, normalizedQuery)
  ) {
    return 'title_match'
  }
  // Rank tier 5 (every query term, acronym-aware) is full title evidence:
  // every term the caller typed names this judgment, so it keeps the
  // 'title_match' card its rank already claims.
  if (titleContainsEveryQueryTerm(normalizedTitle, normalizedQuery)) {
    return 'title_match'
  }
  // Rank tier 4 fires on one distinctive title term (e.g. 'Donoghue' of a
  // misspelled 'Donoghue v Stevnson'). Calling that 'title_match' would
  // overstate single-term evidence alongside full matches like Prest, and
  // leaving it as 'body_text_match' is what put a title win in body
  // clothing. 'partial_title_match' names the evidence honestly while
  // keeping the tier's rank above every body tier, which the comparator
  // (not this label) decides.
  if (titleContainsAnySearchableQueryTerm(normalizedTitle, normalizedQuery)) {
    return 'partial_title_match'
  }

  if (hasSnippetMatch) return 'body_text_match'

  return 'keyword_match'
}

/**
 * Labels a served hit against the recognised citation. Exact reuses the
 * match reason (no second definition of exactness); citing reads the body
 * text the hit already carries. Null unless the query was a recognised
 * citation, so party-name responses gain no new key.
 */
function getCitationMatch(
  hit: LegalSearchHit,
  recognisedCitation: string | null,
  matchReason: LegalSearchMatchReason,
  snippets: LegalSearchSnippet[],
): LegalSearchCitationMatch | undefined {
  if (!recognisedCitation) return undefined
  if (
    matchReason === 'exact_document_id' ||
    matchReason === 'exact_neutral_citation'
  ) {
    return 'exact'
  }

  // A title naming the queried citation proves the judgment discusses it,
  // which is what the served header claims for not-held citations. Without
  // this, bodyless live hits read as keyword neighbours on the card while
  // the header calls the same set citing results.
  if (
    containsWholeTerm(
      normalizeCitationValue(hit.title),
      normalizeCitationValue(recognisedCitation),
    )
  ) {
    return 'citing'
  }

  const bodyText = [
    ...(hit.paragraphs?.map((paragraph) => paragraph.text) ?? []),
    ...snippets.map((snippet) => snippet.text),
  ].join(' ')
  if (bodyText && containsEveryQueryTerm(bodyText, recognisedCitation)) {
    return 'citing'
  }
  return 'none'
}

function scoreLegalSearchMatch(matchReason: LegalSearchMatchReason) {
  switch (matchReason) {
    case 'exact_document_id':
      return 1
    case 'exact_neutral_citation':
      return 0.95
    case 'title_match':
      return 0.8
    // Display score only: ordering comes from the rank-tier comparator,
    // which this label leaves untouched. It still sits between full title
    // and body so any score reader agrees with the tier order.
    case 'partial_title_match':
      return 0.72
    case 'body_text_match':
      return 0.65
    case 'keyword_match':
      return 0.5
  }
}

function inferFetchOutcome(
  hits: LegalFetchSearchHit[],
  hydrationQueued: boolean,
): LegalFetchOutcome {
  if (hits.length > 0) return 'results'
  if (hydrationQueued) return 'hydration_queued'
  return 'no_match'
}
