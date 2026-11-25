import type { LegalSearchFetchResponse } from './components/search/searchTypes'

export function mergeLegalSearchPage(
  previous: LegalSearchFetchResponse,
  next: LegalSearchFetchResponse,
): LegalSearchFetchResponse {
  const seen = new Set(previous.hits.map((hit) => hit.id))
  const hits = [
    ...previous.hits,
    ...next.hits.filter((hit) => {
      if (seen.has(hit.id)) return false
      seen.add(hit.id)
      return true
    }),
  ]
  return {
    ...next,
    hits,
    groups: previous.groups ?? next.groups,
    primaryGroup: previous.primaryGroup ?? next.primaryGroup,
  }
}
