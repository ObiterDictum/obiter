import type { LegalSearchRequestFilters } from './components/search'
import type { SearchResultType } from './components/search/searchResultRows'

export interface LegalSearchUrl {
  q?: string
  court?: string
  from?: string
  to?: string
  type?: 'judgments' | 'legislation'
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateLegalSearchSearch(
  search: Record<string, unknown>,
): LegalSearchUrl {
  const params: LegalSearchUrl = {}
  const query = textValue(search.q)
  if (query) params.q = query
  const court = textValue(search.court)
  if (court) params.court = court
  const from = textValue(search.from)
  if (isoDate.test(from)) params.from = from
  const to = textValue(search.to)
  if (isoDate.test(to)) params.to = to
  if (search.type === 'judgments' || search.type === 'legislation') {
    params.type = search.type
  }
  return params
}

export function legalSearchUrlFilters(
  params: LegalSearchUrl,
): LegalSearchRequestFilters {
  return {
    court: params.court ?? '',
    dateFrom: params.from ?? '',
    dateTo: params.to ?? '',
  }
}

export function legalSearchUrlType(params: LegalSearchUrl): SearchResultType {
  return params.type ?? 'all'
}

export function legalSearchUrl(
  query: string,
  filters: LegalSearchRequestFilters,
  type: SearchResultType,
): LegalSearchUrl {
  const params: LegalSearchUrl = {}
  const trimmedQuery = query.trim()
  if (trimmedQuery) params.q = trimmedQuery
  const court = filters.court.trim()
  if (court) params.court = court
  const from = filters.dateFrom.trim()
  if (isoDate.test(from)) params.from = from
  const to = filters.dateTo.trim()
  if (isoDate.test(to)) params.to = to
  if (type !== 'all') params.type = type
  return params
}

export function legalSearchUrlKey(params: LegalSearchUrl) {
  return [
    params.q ?? '',
    params.court ?? '',
    params.from ?? '',
    params.to ?? '',
    params.type ?? 'all',
  ].join('\u0000')
}
