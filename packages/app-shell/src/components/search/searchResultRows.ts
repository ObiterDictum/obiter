import type {
  LegalSearchBrowseContext,
  LegalSearchFetchResponse,
  LegalSearchResult,
  LegislationSearchResultHit,
} from './searchTypes'

export type SearchResultRow =
  | { kind: 'judgment'; hit: LegalSearchResult }
  | { kind: 'legislation'; hit: LegislationSearchResultHit }

export type SearchResultType = 'all' | 'judgments' | 'legislation'

function legislationHits(
  response: LegalSearchFetchResponse,
): LegislationSearchResultHit[] {
  return response.groups?.flatMap((group) => group.hits) ?? []
}

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

export function filterSearchResultRows(
  rows: SearchResultRow[],
  type: SearchResultType,
): SearchResultRow[] {
  if (type === 'all') return rows
  const kind = type === 'judgments' ? 'judgment' : 'legislation'
  return rows.filter((row) => row.kind === kind)
}

export function formatResultSummary(
  response: LegalSearchFetchResponse,
  browse?: LegalSearchBrowseContext,
  type: SearchResultType = 'all',
): string {
  const legislation = legislationHits(response)
  const resultCount = response.hits.length + legislation.length
  if (browse) {
    const caseLabel = response.hits.length === 1 ? 'case' : 'cases'
    return `${response.hits.length} recent ${caseLabel} for ${browse.courtLabel} from stored legal sources`
  }

  const source = formatResultSource(response)
  const allRows = searchResultRows(response)
  const parts = countSummaryParts(allRows)
  if (type !== 'all') {
    const visibleParts = countSummaryParts(
      filterSearchResultRows(allRows, type),
    )
    if (parts.length === 0) return `No results ${source}`
    const allResults = `${parts.join(' · ')} in all results`
    if (visibleParts.length === 0) {
      return `No ${type === 'judgments' ? 'judgments' : 'legislation results'} shown · ${allResults} ${source}`
    }
    return `${visibleParts.join(' · ')} shown · ${allResults} ${source}`
  }
  if (
    response.citation?.status === 'not_held' &&
    response.hits.length > 0 &&
    response.diagnostics?.legislationNotHeld !== true
  ) {
    if (response.hits.every((hit) => hit.citationMatch === 'citing')) {
      return `Citation not held · ${response.hits.length} citing ${response.hits.length === 1 ? 'result' : 'results'} ${source}`
    }
    return `Citation not held · ${response.hits.length} ${response.hits.length === 1 ? 'result' : 'results'} ${source}`
  }

  if (parts.length === 0) return `No results ${source}`
  return `${parts.join(' · ')} ${source}${
    response.estimatedTotalHits && response.estimatedTotalHits > resultCount
      ? ` · ${response.estimatedTotalHits} matching in the index`
      : ''
  }`
}

function countSummaryParts(rows: SearchResultRow[]) {
  const judgments = rows.filter((row) => row.kind === 'judgment').length
  const legislationRows = rows.flatMap((row) =>
    row.kind === 'legislation' ? [row.hit] : [],
  )
  const acts = legislationRows.filter((hit) => !hit.labelPath).length
  const provisions = legislationRows.length - acts
  return [
    countResults(judgments, 'judgment'),
    countResults(acts, 'Act'),
    countResults(provisions, 'provision'),
  ].filter(Boolean)
}

function countResults(count: number, noun: string) {
  return count ? `${count} ${noun}${count === 1 ? '' : 's'}` : null
}

function formatResultSource(response: LegalSearchFetchResponse) {
  const paths = new Set(
    response.hits.map((hit) => hit.retrievalPath).filter(Boolean),
  )
  const hasLive = paths.has('live_provider')
  const hasStored = [...paths].some((path) => path?.startsWith('stored'))
  if (hasLive && hasStored) {
    return 'from stored legal sources and Find Case Law'
  }
  if (hasLive) {
    return 'from Find Case Law'
  }
  if (hasStored) {
    return 'from stored legal sources'
  }
  return `from ${response.cached ? 'stored legal sources' : 'legal sources'}`
}
