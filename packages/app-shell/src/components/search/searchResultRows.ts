import type {
  LegalSearchFetchResponse,
  LegalSearchResult,
  LegislationSearchResultHit,
} from './searchTypes'

export type SearchResultRow =
  | { kind: 'judgment'; hit: LegalSearchResult }
  | { kind: 'legislation'; hit: LegislationSearchResultHit }

export function legislationHits(
  response: LegalSearchFetchResponse,
): LegislationSearchResultHit[] {
  return response.groups?.flatMap((group) => group.hits) ?? []
}

/**
 * Display order of the two federated groups. Ranking inside each group is
 * unchanged; this only swaps which heading comes first.
 */
export function searchResultRows(
  response: LegalSearchFetchResponse,
): SearchResultRow[] {
  const judgments: SearchResultRow[] = response.hits.map((hit) => ({
    kind: 'judgment',
    hit,
  }))
  const legislation: SearchResultRow[] = legislationHits(response).map(
    (hit) => ({ kind: 'legislation', hit }),
  )
  if (response.primaryGroup === 'legislation') {
    return [...legislation, ...judgments]
  }
  return [...judgments, ...legislation]
}
