import {
  createCanonicalCasePath,
  type ApiErrorResponse,
  type LegalSearchCitation,
  type LegalSearchCitationMatch,
  type LegalSearchCitationStatus,
  type LegislationScheduleGuidance,
} from '@obiter/contracts'

export type LegalFetchPrimaryGroup = 'judgments' | 'legislation'
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
  type AppliedLegislationSearchParameters,
  type LegalSearchHit,
  type LegalSearchMatchReason,
  type LegalSearchSnippet,
} from '@obiter/search-client'

export type LegalFetchRetrievalPath =
  'stored_exact_lookup' | 'stored_index' | 'live_provider'
type LegalFetchResultGroupKey = 'judgments' | 'legislation'
export type LegalFetchOutcome =
  | 'results'
  | 'no_match'
  | 'hydration_queued'
  | 'stored_browse_empty'
  | 'unsupported_source_type'
  | 'recognised_not_held'
  | 'legislation_title_unresolved'
  | 'legislation_ambiguous'
  | 'legislation_schedule_underspecified'
export interface LegalFetchSearchHit extends LegalSearchHit {
  canonicalUrl?: string
  evidenceIds?: string[]
  matchReason?: LegalSearchMatchReason
  citationMatch?: LegalSearchCitationMatch
  retrievalPath?: LegalFetchRetrievalPath
  retrievalRank?: number
  retrievalScore?: number
  paragraphs?: LegalAuthority['paragraphs']
  resultGroup?: LegalFetchResultGroupKey
}
export interface LegislationFetchHit {
  id: string
  resultGroup: 'legislation'
  legislationStatus: 'current' | 'amended_not_held'
  title: string
  year: number
  provisionLabel: string
  labelPath: string
  documentIdentity: string
  extent: string
  canonicalUrl?: string
  text?: string
  snippets?: Array<{ text: string }>
  officialUrl: string
  sourceUrl: string
  notice?: string
  citationMatch?: LegalSearchCitationMatch
  retrievalPath?: LegalFetchRetrievalPath
  retrievalRank?: number
}

export interface LegalFetchResultGroup {
  key: LegalFetchResultGroupKey
  label: string
  hits: LegislationFetchHit[]
}

export function amendedProvisionNotice(officialUrl: string): string {
  return (
    'This provision is affected by amendments that have been recorded but not ' +
    'yet applied to the published text. Obiter does not hold the amended wording, ' +
    `so no text is shown. Read the official revised provision: ${officialUrl}`
  )
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
    citation?: LegalSearchCitation
    groups?: LegalFetchResultGroup[]
    primaryGroup?: LegalFetchPrimaryGroup
    diagnostics?: {
      exactLookupSearched?: boolean
      storedIndexSearched?: boolean
      liveProviderSearched?: boolean
      storedOnlyBrowse?: boolean
      foregroundLiveIgnored?: boolean
      citationRecognised?: boolean
      citationStatus?: LegalSearchCitationStatus
      legislationSearchFailed?: boolean
      judgmentSearchFailed?: boolean
      legislationSearched?: boolean
      legislationGroupServed?: boolean
      legislationNotHeld?: boolean
      legislationTitleUnresolved?: boolean
      legislationAmbiguous?: boolean
      legislationScheduleGuidance?: LegislationScheduleGuidance
      legislationNote?: string
      legislationSearchParameters?: AppliedLegislationSearchParameters
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
    citation: options.citation,
    diagnostics: options.diagnostics,
    groups: options.groups,
    primaryGroup: options.primaryGroup,
  }
}

export function toSummaryHit(
  hit: LegalSearchHit,
  query = '',
  options: {
    retrievalPath?: LegalFetchRetrievalPath
    retrievalRank?: number
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
  if (titleContainsEveryQueryTerm(normalizedTitle, normalizedQuery)) {
    return 'title_match'
  }
  if (titleContainsAnySearchableQueryTerm(normalizedTitle, normalizedQuery)) {
    return 'partial_title_match'
  }

  if (hasSnippetMatch) return 'body_text_match'

  return 'keyword_match'
}

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
