import { useRef, useState, type FormEvent } from 'react'
import { Card } from '@ormont/ui'
import {
  SearchCommandBar,
  SearchFeedbackPanel,
  SearchFiltersDialog,
  SearchResults,
  courtOptionGroups,
  getCourtLabel,
  type LegalSearchRequestFilters,
  type LegalSearchFetchResponse,
  type CaseLawParagraph,
  type LegalSearchResult,
  type LegalSearchState,
} from '../components/search'

export { courtOptionGroups, getCourtLabel }

export function getLegalSearchStateLabel(state: LegalSearchState) {
  switch (state.status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'loading'
    case 'results':
      return 'results'
    case 'empty':
      return 'empty'
    case 'error':
      return 'error'
  }
}

export function selectParagraphExcerpts(
  result: LegalSearchResult,
  query: string,
): CaseLawParagraph[] {
  const normalizedQuery = query.trim().toLowerCase()
  const paragraphs = result.paragraphs ?? []

  if (!normalizedQuery) {
    return paragraphs.slice(0, 3)
  }

  const matches = paragraphs.filter((paragraph) =>
    paragraph.text.toLowerCase().includes(normalizedQuery),
  )

  return (matches.length > 0 ? matches : paragraphs).slice(0, 3)
}

export function selectJudgmentParagraphs(result: LegalSearchResult): CaseLawParagraph[] {
  return result.paragraphs ?? []
}

export function createLegalSearchFetchRequest(query: string, filters: LegalSearchRequestFilters) {
  const trimmedQuery = query.trim()
  const request: { query: string; court?: string; dateFrom?: string; dateTo?: string } = {
    query: trimmedQuery,
  }
  const court = filters.court.trim()
  const dateFrom = filters.dateFrom.trim()
  const dateTo = filters.dateTo.trim()

  if (court) request.court = court
  if (dateFrom) request.dateFrom = dateFrom
  if (dateTo) request.dateTo = dateTo

  return request
}

export function countActiveLegalSearchFilters(filters: LegalSearchRequestFilters) {
  return [filters.court, filters.dateFrom, filters.dateTo].filter((value) => value.trim()).length
}

export function getLegalSearchStateAfterInputChange(): LegalSearchState {
  return { status: 'idle' }
}

export function LegalSearchView() {
  const [query, setQuery] = useState(() => readInitialSearchQuery())
  const [court, setCourt] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [state, setState] = useState<LegalSearchState>({ status: 'idle' })
  const searchRequestId = useRef(0)

  async function runSearch(
    searchQuery = query,
    searchFilters: LegalSearchRequestFilters = { court, dateFrom, dateTo },
  ) {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) return

    const requestId = searchRequestId.current + 1
    searchRequestId.current = requestId
    setState({ status: 'loading', query: trimmedQuery })

    try {
      const response = await fetch('/api/search/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createLegalSearchFetchRequest(trimmedQuery, searchFilters)),
      })

      if (searchRequestId.current !== requestId) return

      if (!response.ok) {
        setState({
          status: 'error',
          query: trimmedQuery,
          message:
            response.status === 503
              ? 'Find Case Law is currently unreachable. Cached results may still be available through standard search.'
              : 'Search could not complete the request.',
        })
        return
      }

      const body = (await response.json()) as LegalSearchFetchResponse
      if (searchRequestId.current !== requestId) return
      setState(
        body.hits.length > 0
          ? { status: 'results', query: trimmedQuery, response: body }
          : { status: 'empty', query: trimmedQuery, hydrationQueued: body.hydrationQueued },
      )
    } catch {
      if (searchRequestId.current !== requestId) return
      setState({
        status: 'error',
        query: trimmedQuery,
        message: 'Search could not reach the API.',
      })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runSearch()
  }

  function applyFilters(filters: LegalSearchRequestFilters) {
    setCourt(filters.court)
    setDateFrom(filters.dateFrom)
    setDateTo(filters.dateTo)
    setFiltersOpen(false)
    searchRequestId.current += 1
    setState({ status: 'idle' })
  }

  function clearFilters() {
    setCourt('')
    setDateFrom('')
    setDateTo('')
    setFiltersOpen(false)
    searchRequestId.current += 1
    setState({ status: 'idle' })
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery)
    searchRequestId.current += 1
    setState(getLegalSearchStateAfterInputChange())
  }

  const courtLabel = getCourtLabel(court)
  const activeFilterCount = countActiveLegalSearchFilters({ court, dateFrom, dateTo })

  return (
    <div className="shell-stack legal-search">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Legal sources</p>
          <h1 className="shell-header__title">Search</h1>
        </div>
      </section>

      <Card className="legal-search__panel">
        <SearchCommandBar
          activeFilterCount={activeFilterCount}
          courtLabel={courtLabel}
          dateFrom={dateFrom}
          dateTo={dateTo}
          isSearching={state.status === 'loading'}
          onFilterClick={() => setFiltersOpen(true)}
          onQueryChange={handleQueryChange}
          onSubmit={handleSubmit}
          query={query}
        />
      </Card>

      {filtersOpen ? (
        <SearchFiltersDialog
          court={court}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApply={applyFilters}
          onClear={clearFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {state.status === 'empty' ? (
        <SearchFeedbackPanel
          eyebrow={state.hydrationQueued ? 'Search queued' : 'No results'}
          title={state.hydrationQueued ? 'Checking legal sources' : 'No sources found'}
          body={
            state.hydrationQueued
              ? `Stored sources did not yet have "${state.query}". Public legal source hydration is queued; retry shortly for newly indexed results.`
              : `No stored legal sources matched "${state.query}" with the selected filters.`
          }
          tone="warning"
        />
      ) : null}

      {state.status === 'error' ? (
        <SearchFeedbackPanel
          action={{ label: 'Retry search', onClick: () => void runSearch(state.query) }}
          eyebrow="Search error"
          title="Search could not complete"
          body={state.message}
          tone="error"
        />
      ) : null}

      {state.status === 'results' ? (
        <SearchResults response={state.response} />
      ) : null}
    </div>
  )
}

function readInitialSearchQuery() {
  if (typeof window === 'undefined') {
    return ''
  }

  const query = window.sessionStorage.getItem('ormont.search.initialQuery') ?? ''
  window.sessionStorage.removeItem('ormont.search.initialQuery')
  return query
}
