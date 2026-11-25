import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { apiUrl } from './lib/api-url'
import { caseResultLocation } from './case-navigation'
import { rememberFirstRunSearched } from './first-run-checklist'
import { provisionResultLocation } from './legislation-navigation'
import {
  getCourtLabel,
  getLegislationScheduleResubmitQuery,
  isInteractiveTarget,
  type LegalSearchFetchResponse,
  type LegalSearchRequestFilters,
  type LegalSearchState,
} from './components/search'
import {
  filterSearchResultRows,
  searchResultRows,
  type SearchResultType,
} from './components/search/searchResultRows'
import {
  clearRecentLegalSearches,
  getRecentLegalSearches,
  writeRecentLegalSearch,
} from './legal-search-recents'
import {
  isTextEntryTarget,
  readSearchErrorMessage,
} from './legal-search-runtime'
import {
  LEGAL_SEARCH_DEBOUNCE_MS,
  LEGAL_SEARCH_HYDRATION_MAX_POLLS,
  LEGAL_SEARCH_HYDRATION_POLL_MS,
  createLegalSearchFetchRequest,
  getLegalSearchStateAfterInputChange,
  shouldRunLegalSearch,
  shouldRunLegalSearchRequest,
} from './legal-search-state'
import {
  legalSearchUrl,
  legalSearchUrlFilters,
  legalSearchUrlKey,
  legalSearchUrlType,
  validateLegalSearchSearch,
  type LegalSearchUrl,
} from './legal-search-url'

export function useLegalSearch() {
  const navigate = useNavigate()
  // SAFETY: useSearch with strict:false returns an untyped record, and validateLegalSearchSearch narrows each parameter.
  const urlParams = validateLegalSearchSearch(
    useSearch({ strict: false }) as Record<string, unknown>,
  )
  const urlKey = legalSearchUrlKey(urlParams)
  const [query, setQuery] = useState(urlParams.q ?? '')
  const [court, setCourt] = useState(urlParams.court ?? '')
  const [dateFrom, setDateFrom] = useState(urlParams.from ?? '')
  const [dateTo, setDateTo] = useState(urlParams.to ?? '')
  const [recentSearches, setRecentSearches] = useState(() =>
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage),
  )
  const [typeFilter, setTypeFilter] = useState<SearchResultType>(
    legalSearchUrlType(urlParams),
  )
  const typeFilterRef = useRef(typeFilter)

  function updateTypeFilter(nextType: SearchResultType) {
    typeFilterRef.current = nextType
    setTypeFilter(nextType)
  }
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1)
  const [state, setState] = useState<LegalSearchState>({ status: 'idle' })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchRequestId = useRef(0)
  const autoSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortController = useRef<AbortController | null>(null)
  const appliedUrlKey = useRef<string | null>(null)
  const committedUrlKey = useRef<string | null>(null)
  const committedUrlParams = useRef<LegalSearchUrl | null>(null)

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
    setPreviewOpen(false)
  }

  function supersedeActiveSearch() {
    cancelInFlightSearch()
    searchRequestId.current += 1
  }

  function keepSearchInputFocused() {
    searchInputRef.current?.focus()
  }

  const filters = { court, dateFrom, dateTo }
  const rows =
    state.status === 'results'
      ? filterSearchResultRows(searchResultRows(state.response), typeFilter)
      : []
  const selectedRow = rows[selectedResultIndex]

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

      if (rows.length === 0) return

      const interactiveTarget = isInteractiveTarget(event.target)

      if (
        !interactiveTarget &&
        (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j')
      ) {
        event.preventDefault()
        setSelectedResultIndex((currentIndex) =>
          Math.min(currentIndex + 1, rows.length - 1),
        )
        return
      }

      if (
        !interactiveTarget &&
        (event.key === 'ArrowUp' || event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault()
        setSelectedResultIndex((currentIndex) =>
          currentIndex <= 0 ? 0 : currentIndex - 1,
        )
        return
      }

      if (
        !interactiveTarget &&
        event.key === 'Enter' &&
        selectedResultIndex >= 0
      ) {
        const selected = rows[selectedResultIndex]
        if (!selected) return

        event.preventDefault()
        if (selected.kind === 'judgment') {
          void navigate(caseResultLocation(selected.hit))
          return
        }
        if (!selected.hit.labelPath) return
        void navigate(provisionResultLocation(selected.hit))
      }
    }

    window.addEventListener('keydown', handleSearchKeyDown)

    return () => {
      window.removeEventListener('keydown', handleSearchKeyDown)
    }
  }, [navigate, rows, selectedResultIndex, shortcutsOpen, state.status])

  const applyUrlParams = useEffectEvent((key: string) => {
    if (appliedUrlKey.current === key) return
    appliedUrlKey.current = key
    committedUrlKey.current = key
    committedUrlParams.current = urlParams
    const params = urlParams
    const nextFilters = legalSearchUrlFilters(params)
    setQuery(params.q ?? '')
    setCourt(nextFilters.court)
    setDateFrom(nextFilters.dateFrom)
    setDateTo(nextFilters.dateTo)
    updateTypeFilter(legalSearchUrlType(params))
    setSelectedResultIndex(-1)
    setPreviewOpen(false)
    if (shouldRunLegalSearchRequest(params.q ?? '', nextFilters)) {
      void runSearch(params.q ?? '', nextFilters)
      return
    }
    resetSearchToIdle()
  })

  useEffect(() => {
    applyUrlParams(urlKey)
  }, [urlKey])

  useEffect(() => {
    return () => {
      clearAutoSearchTimer()
      cancelInFlightSearch()
      searchRequestId.current += 1
      appliedUrlKey.current = null
      committedUrlKey.current = null
      committedUrlParams.current = null
    }
  }, [])
  async function runSearch(
    searchQuery = query,
    searchFilters: LegalSearchRequestFilters = filters,
    options: { clearDebounce?: boolean; hydrationAttempt?: number } = {},
  ) {
    if (options.clearDebounce ?? true) clearAutoSearchTimer()

    const trimmedQuery = searchQuery.trim()
    const storedOnlyBrowse =
      !trimmedQuery && Boolean(searchFilters.court.trim())
    const browse = storedOnlyBrowse
      ? { courtLabel: getCourtLabel(searchFilters.court) }
      : undefined
    if (!trimmedQuery && !storedOnlyBrowse) {
      resetSearchToIdle()
      return
    }
    if (trimmedQuery && typeof window !== 'undefined') {
      setRecentSearches(
        writeRecentLegalSearch(window.sessionStorage, trimmedQuery),
      )
      rememberFirstRunSearched(window.localStorage)
    }

    const requestId = searchRequestId.current + 1
    searchRequestId.current = requestId
    cancelInFlightSearch()
    const requestAbortController = new AbortController()
    abortController.current = requestAbortController
    setState({ status: 'loading', query: trimmedQuery })
    setSelectedResultIndex(-1)
    setPreviewOpen(false)

    try {
      const response = await fetch(apiUrl('/api/search/fetch'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: requestAbortController.signal,
        body: JSON.stringify(
          createLegalSearchFetchRequest(trimmedQuery, searchFilters),
        ),
      })

      if (searchRequestId.current !== requestId) return

      if (!response.ok) {
        if (abortController.current === requestAbortController)
          abortController.current = null
        setState({
          status: 'error',
          query: trimmedQuery,
          message: await readSearchErrorMessage(response),
        })
        keepSearchInputFocused()
        return
      }

      // SAFETY: non-ok responses return early above; /api/search/fetch returns LegalSearchFetchResponse per the search API contract.
      const body = (await response.json()) as LegalSearchFetchResponse
      if (searchRequestId.current !== requestId) return
      if (abortController.current === requestAbortController)
        abortController.current = null
      const groupHitCount = (body.groups ?? []).reduce(
        (sum, group) => sum + group.hits.length,
        0,
      )
      if (body.hits.length > 0 || groupHitCount > 0) {
        setState({
          status: 'results',
          query: trimmedQuery,
          response: body,
          browse,
        })
        setSelectedResultIndex(0)
        keepSearchInputFocused()
        return
      }
      const legislationNote = body.diagnostics?.legislationNote
      const legislationNotHeld = body.diagnostics?.legislationNotHeld === true
      const legislationTitleUnresolved =
        body.diagnostics?.legislationTitleUnresolved === true
      const legislationAmbiguous =
        body.diagnostics?.legislationAmbiguous === true
      const legislationScheduleGuidance =
        body.diagnostics?.legislationScheduleGuidance
      const outcome =
        body.outcome ?? (body.hydrationQueued ? 'hydration_queued' : 'no_match')
      const hydrationAttempt = options.hydrationAttempt ?? 0
      if (
        outcome === 'hydration_queued' &&
        hydrationAttempt < LEGAL_SEARCH_HYDRATION_MAX_POLLS
      ) {
        const nextAttempt = hydrationAttempt + 1
        setState({
          status: 'empty',
          query: trimmedQuery,
          outcome,
          hydrationQueued: body.hydrationQueued,
          browse,
          legislationNote,
          legislationNotHeld,
          legislationTitleUnresolved,
          legislationAmbiguous,
          legislationScheduleGuidance,
          hydrationAttempt: nextAttempt,
        })
        setSelectedResultIndex(-1)
        clearAutoSearchTimer()
        autoSearchTimer.current = setTimeout(() => {
          autoSearchTimer.current = null
          void runSearch(trimmedQuery, searchFilters, {
            clearDebounce: false,
            hydrationAttempt: nextAttempt,
          })
        }, LEGAL_SEARCH_HYDRATION_POLL_MS)
        keepSearchInputFocused()
        return
      }
      setState({
        status: 'empty',
        query: trimmedQuery,
        outcome,
        hydrationQueued: body.hydrationQueued,
        browse,
        legislationNote,
        legislationNotHeld,
        legislationTitleUnresolved,
        legislationAmbiguous,
        legislationScheduleGuidance,
        hydrationAttempt:
          outcome === 'hydration_queued' ? hydrationAttempt + 1 : undefined,
        hydrationExpired: outcome === 'hydration_queued' ? true : undefined,
      })
      setSelectedResultIndex(-1)
      keepSearchInputFocused()
    } catch {
      if (searchRequestId.current !== requestId) return
      if (requestAbortController.signal.aborted) return
      if (abortController.current === requestAbortController)
        abortController.current = null
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
    searchFilters: LegalSearchRequestFilters = filters,
  ) {
    clearAutoSearchTimer()
    if (!shouldRunLegalSearchRequest(searchQuery, searchFilters)) {
      resetSearchToIdle()
      return
    }

    supersedeActiveSearch()
    autoSearchTimer.current = setTimeout(() => {
      autoSearchTimer.current = null
      writeSearchUrl(searchQuery, searchFilters, typeFilterRef.current, 'push')
      void runSearch(searchQuery, searchFilters, { clearDebounce: false })
    }, LEGAL_SEARCH_DEBOUNCE_MS)
  }

  function writeSearchUrl(
    nextQuery: string,
    nextFilters: LegalSearchRequestFilters,
    nextType: SearchResultType,
    history: 'push' | 'replace' = 'replace',
  ) {
    const params = legalSearchUrl(nextQuery, nextFilters, nextType)
    const key = legalSearchUrlKey(params)
    if (history === 'push') {
      if (committedUrlKey.current === key) return
      const previousKey = committedUrlKey.current
      const previousParams = committedUrlParams.current
      const restoreCommittedEntry =
        previousKey !== null &&
        previousParams !== null &&
        appliedUrlKey.current !== previousKey
      committedUrlKey.current = key
      committedUrlParams.current = params
      if (restoreCommittedEntry) {
        appliedUrlKey.current = previousKey
        void Promise.resolve(
          navigate({ to: '/search', search: previousParams, replace: true }),
        ).then(() => {
          appliedUrlKey.current = key
          return navigate({ to: '/search', search: params, replace: false })
        })
        return
      }
      appliedUrlKey.current = key
      void navigate({ to: '/search', search: params, replace: false })
      return
    }
    appliedUrlKey.current = key
    void navigate({ to: '/search', search: params, replace: true })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    writeSearchUrl(query, filters, typeFilter, 'push')
    await runSearch()
  }

  function applyFilters(
    nextFilters: LegalSearchRequestFilters,
    nextType: SearchResultType = typeFilter,
  ) {
    setCourt(nextFilters.court)
    setDateFrom(nextFilters.dateFrom)
    setDateTo(nextFilters.dateTo)
    updateTypeFilter(nextType)
    setSelectedResultIndex(-1)
    setPreviewOpen(false)
    writeSearchUrl(query, nextFilters, nextType, 'push')
    scheduleAutoSearch(query, nextFilters)
  }

  function removeFilter(filter: 'court' | 'dateFrom' | 'dateTo') {
    applyFilters({
      court: filter === 'court' ? '' : court,
      dateFrom: filter === 'dateFrom' ? '' : dateFrom,
      dateTo: filter === 'dateTo' ? '' : dateTo,
    })
  }

  function clearFilters() {
    applyFilters({ court: '', dateFrom: '', dateTo: '' }, 'all')
  }

  function setResultType(nextType: SearchResultType) {
    updateTypeFilter(nextType)
    setSelectedResultIndex(0)
    writeSearchUrl(query, filters, nextType, 'push')
  }

  function clearTypeFilter() {
    updateTypeFilter('all')
    setSelectedResultIndex(0)
    writeSearchUrl(query, filters, 'all', 'push')
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    setPreviewOpen(false)
    writeSearchUrl(nextQuery, filters, typeFilter)
    scheduleAutoSearch(nextQuery)
  }

  function clearQuery() {
    setQuery('')
    resetSearchToIdle()
    writeSearchUrl('', filters, typeFilter)
    keepSearchInputFocused()
  }

  function handleRecentSearch(searchQuery: string) {
    setQuery(searchQuery)
    writeSearchUrl(searchQuery, filters, typeFilter, 'push')
    void runSearch(searchQuery)
  }

  function clearRecents() {
    if (typeof window !== 'undefined') {
      clearRecentLegalSearches(window.sessionStorage)
    }
    setRecentSearches([])
  }

  function resubmitQuery(nextQuery: string) {
    setQuery(nextQuery)
    writeSearchUrl(nextQuery, filters, typeFilter, 'push')
    void runSearch(nextQuery)
  }

  function handleCourtShortcut(nextCourt: string) {
    setQuery(query)
    applyFilters({ court: nextCourt, dateFrom, dateTo })
  }

  const courtLabel = getCourtLabel(court)
  const scheduleResubmitQuery =
    state.status === 'empty' && state.legislationScheduleGuidance
      ? getLegislationScheduleResubmitQuery(state.legislationScheduleGuidance)
      : null
  const shouldShowIdleState =
    state.status === 'idle' && !shouldRunLegalSearch(query)

  return {
    query,
    state,
    recentSearches,
    court,
    dateFrom,
    dateTo,
    typeFilter,
    shortcutsOpen,
    previewOpen,
    selectedResultIndex,
    selectedRow,
    rows,
    filters,
    searchInputRef,
    courtLabel,
    scheduleResubmitQuery,
    shouldShowIdleState,
    runSearch,
    handleSubmit,
    handleQueryChange,
    clearQuery,
    handleRecentSearch,
    clearRecents,
    handleCourtShortcut,
    applyFilters,
    removeFilter,
    clearFilters,
    clearTypeFilter,
    resubmitQuery,
    setSelectedResultIndex,
    setPreviewOpen,
    setShortcutsOpen,
    setResultType,
  }
}
