import {
  createCanonicalCasePath,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { LegalAuthority } from '@obiter/legal-schema'
import {
  containsWholeTerm,
  createJudgmentParagraphEvidenceId,
  extractLegalSearchSnippets,
  normalizeExactMatchValue,
  type LegalSearchHit,
  type LegalSearchMatchReason,
} from '@obiter/search-client'

export type LegalFetchRetrievalPath =
  'stored_exact_lookup' | 'stored_index' | 'stored_source' | 'live_provider'
export type LegalFetchOutcome =
  | 'results'
  | 'no_match'
  | 'hydration_queued'
  | 'stored_browse_empty'
  | 'unsupported_source_type'
export interface LegalFetchSearchHit extends LegalSearchHit {
  canonicalUrl?: string
  evidenceIds?: string[]
  matchReason?: LegalSearchMatchReason
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
    diagnostics?: {
      exactLookupSearched?: boolean
      storedIndexSearched?: boolean
      storedSourceSearched?: boolean
      liveProviderSearched?: boolean
      storedOnlyBrowse?: boolean
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
    diagnostics: options.diagnostics,
  }
}

export function toSummaryHit(
  hit: LegalSearchHit,
  query = '',
  options: {
    retrievalPath?: LegalFetchRetrievalPath
    retrievalRank?: number
  } = {},
): LegalFetchSearchHit {
  const snippets = hit.snippets ?? extractLegalSearchSnippets(hit, query)
  const matchReason = getLegalSearchMatchReason(hit, query, snippets.length > 0)
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
  if (normalizeExactMatchValue(hit.neutralCitation) === normalizedQuery)
    return 'exact_neutral_citation'

  const normalizedTitle = normalizeExactMatchValue(hit.title)
  if (
    normalizedTitle === normalizedQuery ||
    containsWholeTerm(normalizedTitle, normalizedQuery)
  ) {
    return 'title_match'
  }

  if (hasSnippetMatch) return 'body_text_match'

  return 'keyword_match'
}

function scoreLegalSearchMatch(matchReason: LegalSearchMatchReason) {
  switch (matchReason) {
    case 'exact_document_id':
      return 1
    case 'exact_neutral_citation':
      return 0.95
    case 'title_match':
      return 0.8
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
