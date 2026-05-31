import type { ApiErrorResponse } from '@ormont/contracts'
import type { LegalAuthority } from '@ormont/legal-schema'
import { extractLegalSearchSnippets, type LegalSearchHit } from '@ormont/search-client'

export interface LegalFetchSearchHit extends LegalSearchHit {
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
) {
  return {
    hits,
    query,
    estimatedTotalHits: hits.length,
    processingTimeMs: 0,
    cached,
    indexedCount,
    skippedCount,
    hydrationQueued,
  }
}

export function toSummaryHit(hit: LegalSearchHit, query = ''): LegalFetchSearchHit {
  return {
    id: hit.id,
    title: hit.title,
    neutralCitation: hit.neutralCitation,
    court: hit.court,
    jurisdiction: hit.jurisdiction,
    dateDecided: hit.dateDecided,
    sourceType: hit.sourceType,
    sourceUrl: hit.sourceUrl,
    snippets: hit.snippets ?? extractLegalSearchSnippets(hit, query),
  }
}
