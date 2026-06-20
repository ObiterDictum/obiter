import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Card } from '@ormont/ui'
import {
  SearchCommandBar,
  SearchFeedbackPanel,
  SearchFiltersDialog,
  SearchIdleState,
  SearchKeyboardShortcuts,
  SearchResults,
  courtOptionGroups,
  getCourtLabel,
  type LegalSearchRequestFilters,
  type LegalSearchFetchResponse,
  type LegalSearchOutcome,
  type CaseLawParagraph,
  type LegalSearchResult,
  type LegalSearchState,
} from '../components/search'

export { courtOptionGroups, getCourtLabel }

export const LEGAL_SEARCH_DEBOUNCE_MS = 300
export const LEGAL_SEARCH_RECENT_SEARCHES_LIMIT = 5
const legalSearchRecentSearchesKey = 'ormont.search.recentSearches'
const courtShortcuts = [
  { code: 'uksc', label: 'UKSC' },
  { code: 'ewca/civ', label: 'EWCA Civ' },
  { code: 'ewhc/admin', label: 'EWHC Admin' },
]

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

export function createLegalSearchFetchRequest(
  query: string,
  filters: LegalSearchRequestFilters,
  options: { foregroundLiveResults?: boolean } = {},
) {
  const trimmedQuery = query.trim()
  const request: {
    query: string
    court?: string
    dateFrom?: string
    dateTo?: string
    sourceType?: string
    sourceFamily?: string
    legalDomain?: string
    provider?: string
    topic?: string
    asAtDate?: string
    legislationVersion?: string
    foregroundLiveResults: boolean
  } = {
    query: trimmedQuery,
    foregroundLiveResults: options.foregroundLiveResults ?? true,
  }
  const court = filters.court.trim()
  const dateFrom = filters.dateFrom.trim()
  const dateTo = filters.dateTo.trim()
  const optionalFilters = {
    sourceType: filters.sourceType,
    sourceFamily: filters.sourceFamily,
    legalDomain: filters.legalDomain,
    provider: filters.provider,
    topic: filters.topic,
    asAtDate: filters.asAtDate,
    legislationVersion: filters.legislationVersion,
  }

  if (court) request.court = court
  if (dateFrom) request.dateFrom = dateFrom
  if (dateTo) request.dateTo = dateTo
  for (const [key, value] of Object.entries(optionalFilters)) {
    const trimmedValue = value?.trim()
    if (trimmedValue) {
      request[key as keyof typeof optionalFilters] = trimmedValue
    }
  }

  return request
}

export function countActiveLegalSearchFilters(filters: LegalSearchRequestFilters) {
  return [
    filters.court,
    filters.dateFrom,
    filters.dateTo,
    filters.sourceType,
    filters.sourceFamily,
    filters.legalDomain,
    filters.provider,
    filters.topic,
    filters.asAtDate,
    filters.legislationVersion,
  ].filter((value) => value?.trim()).length
}

export function getLegalSearchStateAfterInputChange(): LegalSearchState {
  return { status: 'idle' }
}

export function getLegalSearchEmptyFeedback(input: {
  query: string
  outcome?: LegalSearchOutcome
  hydrationQueued?: boolean
  browse?: { courtLabel: string }
}) {
  const outcome = input.outcome ?? (input.hydrationQueued ? 'hydration_queued' : 'no_match')

  if (outcome === 'hydration_queued') {
    return {
      eyebrow: 'Search queued',
      title: 'Checking legal sources',
      body: `Stored sources did not yet have "${input.query}". Public legal source hydration is queued; retry shortly for newly indexed results.`,
    }
  }

  if (outcome === 'stored_browse_empty' || input.browse) {
    return {
      eyebrow: 'No stored cases',
      title: 'No recent cases found',
      body: `No recent stored cases found for ${input.browse?.courtLabel ?? 'the selected court'}.`,
    }
  }

  return {
    eyebrow: 'No indexed match',
    title: 'No sources found',
    body: `Stored legal sources and available provider results did not match "${input.query}" with the selected filters.`,
  }
}

export function shouldRunLegalSearch(query: string) {
  return query.trim().length > 0
}

export function shouldRunLegalSearchRequest(query: string, filters: LegalSearchRequestFilters) {
  return shouldRunLegalSearch(query) || Boolean(filters.court.trim())
}

export function getRecentLegalSearches(storage: Pick<Storage, 'getItem'> | undefined) {
  if (!storage) return []

  const storedSearches = storage.getItem(legalSearchRecentSearchesKey)
  if (!storedSearches) return []

  try {
    const parsedSearches = JSON.parse(storedSearches) as unknown
    if (!Array.isArray(parsedSearches)) return []

    return dedupeRecentLegalSearches(
      parsedSearches.filter((search): search is string => typeof search === 'string'),
    )
  } catch {
    return []
  }
}

export function writeRecentLegalSearch(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  query: string,
) {
  if (!storage) return []

  const recentSearches = dedupeRecentLegalSearches([query, ...getRecentLegalSearches(storage)])
  storage.setItem(legalSearchRecentSearchesKey, JSON.stringify(recentSearches))
  return recentSearches
}

function dedupeRecentLegalSearches(searches: string[]) {
  const seen = new Set<string>()
  const recentSearches: string[] = []

  for (const search of searches) {
    const trimmedSearch = search.trim()
    const normalizedSearch = trimmedSearch.toLowerCase()
    if (!trimmedSearch || seen.has(normalizedSearch)) continue

    seen.add(normalizedSearch)
    recentSearches.push(trimmedSearch)
    if (recentSearches.length >= LEGAL_SEARCH_RECENT_SEARCHES_LIMIT) break
  }

  return recentSearches
}

export function LegalSearchView() {
  const navigate = useNavigate()
  const [query, setQuery] = useState(() => readInitialSearchQuery())
  const [court, setCourt] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [recentSearches, setRecentSearches] = useState(() =>
    typeof window === 'undefined' ? [] : getRecentLegalSearches(window.sessionStorage),
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1)
  const [state, setState] = useState<LegalSearchState>({ status: 'idle' })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchRequestId = useRef(0)
  const autoSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortController = useRef<AbortController | null>(null)

  function clearAutoSearchTimer() {
    if (autoSearchTimer.current) {
      clearTimeout(autoSearchTimer.current)
      autoSearchTimer.current = null
    }
  }

  function cancelInFlightSearch() {
    abortController.current?.abort()
    abortController.current = null
  }

  function resetSearchToIdle() {
    clearAutoSearchTimer()
    cancelInFlightSearch()
    searchRequestId.current += 1
    setState({ status: 'idle' })
    setSelectedResultIndex(-1)
  }

  function supersedeActiveSearch() {
    cancelInFlightSearch()
    searchRequestId.current += 1
  }

  function keepSearchInputFocused() {
    searchInputRef.current?.focus()
  }

  useEffect(() => {
    function handleSearchKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return

      if (event.key === 'Escape' && shortcutsOpen) {
        event.preventDefault()
        setShortcutsOpen(false)
        return
      }

      if (event.key === '?' && !isTextEntryTarget(event.target)) {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (shortcutsOpen || state.status !== 'results') return

      const resultCount = state.response.hits.length
      if (resultCount === 0) return

      const textEntryTarget = isTextEntryTarget(event.target)

      if (!textEntryTarget && (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j')) {
        event.preventDefault()
        setSelectedResultIndex((currentIndex) => Math.min(currentIndex + 1, resultCount - 1))
        return
      }

      if (!textEntryTarget && (event.key === 'ArrowUp' || event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        setSelectedResultIndex((currentIndex) => (currentIndex <= 0 ? 0 : currentIndex - 1))
        return
      }

      if (!textEntryTarget && event.key === 'Enter' && selectedResultIndex >= 0) {
        const selectedResult = state.response.hits[selectedResultIndex]
        if (!selectedResult) return

        event.preventDefault()
        void navigate({ href: selectedResult.canonicalUrl ?? `/cases/${encodeURIComponent(selectedResult.id)}` })
      }
    }

    window.addEventListener('keydown', handleSearchKeyDown)

    return () => {
      window.removeEventListener('keydown', handleSearchKeyDown)
    }
  }, [navigate, selectedResultIndex, shortcutsOpen, state])

  useEffect(() => {
    return () => {
      clearAutoSearchTimer()
      cancelInFlightSearch()
      searchRequestId.current += 1
    }
  }, [])
  async function runSearch(
    searchQuery = query,
    searchFilters: LegalSearchRequestFilters = { court, dateFrom, dateTo },
    options: { clearDebounce?: boolean } = {},
  ) {
    if (options.clearDebounce ?? true) clearAutoSearchTimer()

    const trimmedQuery = searchQuery.trim()
    const storedOnlyBrowse = !trimmedQuery && Boolean(searchFilters.court.trim())
    const browse = storedOnlyBrowse
      ? { courtLabel: getCourtLabel(searchFilters.court) }
      : undefined
    if (!trimmedQuery && !storedOnlyBrowse) {
      resetSearchToIdle()
      return
    }
    if (trimmedQuery && typeof window !== 'undefined') {
      setRecentSearches(writeRecentLegalSearch(window.sessionStorage, trimmedQuery))
    }

    const requestId = searchRequestId.current + 1
    searchRequestId.current = requestId
    cancelInFlightSearch()
    const requestAbortController = new AbortController()
    abortController.current = requestAbortController
    setState({ status: 'loading', query: trimmedQuery })
    setSelectedResultIndex(-1)

    try {
      const response = await fetch('/api/search/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: requestAbortController.signal,
        body: JSON.stringify(
          createLegalSearchFetchRequest(trimmedQuery, searchFilters, {
            foregroundLiveResults: !storedOnlyBrowse,
          }),
        ),
      })

      if (searchRequestId.current !== requestId) return

      if (!response.ok) {
        if (abortController.current === requestAbortController) abortController.current = null
        setState({
          status: 'error',
          query: trimmedQuery,
          message:
            response.status === 503
              ? 'Find Case Law is currently unreachable. Cached results may still be available through standard search.'
              : 'Search could not complete the request.',
        })
        keepSearchInputFocused()
        return
      }

      const body = (await response.json()) as LegalSearchFetchResponse
      if (searchRequestId.current !== requestId) return
      if (abortController.current === requestAbortController) abortController.current = null
      setState(
        body.hits.length > 0
          ? { status: 'results', query: trimmedQuery, response: body, browse }
          : {
              status: 'empty',
              query: trimmedQuery,
              outcome: body.outcome,
              hydrationQueued: body.hydrationQueued,
              browse,
            },
      )
      setSelectedResultIndex(body.hits.length > 0 ? 0 : -1)
      keepSearchInputFocused()
    } catch {
      if (searchRequestId.current !== requestId) return
      if (requestAbortController.signal.aborted) return
      if (abortController.current === requestAbortController) abortController.current = null
      setState({
        status: 'error',
        query: trimmedQuery,
        message: 'Search could not reach the API.',
      })
      keepSearchInputFocused()
    }
  }

  function scheduleAutoSearch(
    searchQuery: string,
    searchFilters: LegalSearchRequestFilters = { court, dateFrom, dateTo },
  ) {
    clearAutoSearchTimer()
    if (!shouldRunLegalSearchRequest(searchQuery, searchFilters)) {
      resetSearchToIdle()
      return
    }

    supersedeActiveSearch()
    autoSearchTimer.current = setTimeout(() => {
      autoSearchTimer.current = null
      void runSearch(searchQuery, searchFilters, { clearDebounce: false })
    }, LEGAL_SEARCH_DEBOUNCE_MS)
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
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(query, filters)
  }

  function removeFilter(filter: 'court' | 'dateFrom' | 'dateTo') {
    const nextFilters = {
      court: filter === 'court' ? '' : court,
      dateFrom: filter === 'dateFrom' ? '' : dateFrom,
      dateTo: filter === 'dateTo' ? '' : dateTo,
    }
    applyFilters(nextFilters)
  }

  function clearFilters() {
    setCourt('')
    setDateFrom('')
    setDateTo('')
    setFiltersOpen(false)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(query, { court: '', dateFrom: '', dateTo: '' })
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(nextQuery)
  }

  function handleRecentSearch(nextQuery: string) {
    setQuery(nextQuery)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(nextQuery)
  }

  function handleCourtShortcut(nextCourt: string) {
    const nextFilters = { court: nextCourt, dateFrom, dateTo }
    setCourt(nextCourt)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(query, nextFilters)
  }

  const courtLabel = getCourtLabel(court)
  const activeFilterCount = countActiveLegalSearchFilters({ court, dateFrom, dateTo })
  const shouldShowIdleState = state.status === 'idle' && !shouldRunLegalSearch(query)

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
          inputRef={searchInputRef}
          isSearching={state.status === 'loading'}
          onFilterClick={() => setFiltersOpen(true)}
          onQueryChange={handleQueryChange}
          onRemoveFilter={removeFilter}
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

      {shortcutsOpen ? (
        <SearchKeyboardShortcuts onClose={() => setShortcutsOpen(false)} />
      ) : null}

      {shouldShowIdleState ? (
        <SearchIdleState
          courtLabel={courtLabel}
          courtShortcuts={courtShortcuts}
          recentSearches={recentSearches}
          onCourtShortcut={handleCourtShortcut}
          onRecentSearch={handleRecentSearch}
        />
      ) : null}

      {state.status === 'empty' ? (
        <SearchFeedbackPanel
          {...getLegalSearchEmptyFeedback({
            query: state.query,
            outcome: state.outcome,
            hydrationQueued: state.hydrationQueued,
            browse: state.browse,
          })}
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
        <SearchResults
          response={state.response}
          browse={state.browse}
          selectedIndex={selectedResultIndex}
        />
      ) : null}
    </div>
  )
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
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
