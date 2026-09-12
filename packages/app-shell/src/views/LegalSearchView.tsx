import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiUrl } from '../lib/api-url'
import { caseResultLocation } from '../case-navigation'
import { provisionResultLocation } from '../legislation-navigation'
import {
  SearchCommandBar,
  SearchFeedbackPanel,
  SearchFiltersDialog,
  SearchIdleExtras,
  SearchKeyboardShortcuts,
  SearchResults,
  isInteractiveTarget,
  courtOptionGroups,
  getCourtLabel,
  getLegislationScheduleGuidanceFeedback,
  getLegislationScheduleResubmitQuery,
  type LegalSearchRequestFilters,
  type LegalSearchFetchResponse,
  type LegalSearchOutcome,
  type LegislationScheduleGuidance,
  type CaseLawParagraph,
  type LegalSearchResult,
  type LegalSearchState,
} from '../components/search'
import { searchResultRows } from '../components/search/searchResultRows'

export { courtOptionGroups, getCourtLabel }

export const LEGAL_SEARCH_DEBOUNCE_MS = 300
export const LEGAL_SEARCH_RECENT_SEARCHES_LIMIT = 5
// Bounded recheck for hydration_queued: the background path has not
// consulted live yet, so a queue position is honest there but cannot
// resolve itself. Five rechecks at 2s (~10s total) covers a normal
// hydration landing without letting the spinner run forever (the reported
// case polled byte-identical for 80s+). When the bound is reached the UI
// says so plainly instead of spinning on.
export const LEGAL_SEARCH_HYDRATION_POLL_MS = 2000
export const LEGAL_SEARCH_HYDRATION_MAX_POLLS = 5
const legalSearchRecentSearchesKey = 'obiter.search.recentSearches'
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

export function selectJudgmentParagraphs(
  result: LegalSearchResult,
): CaseLawParagraph[] {
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

export function countActiveLegalSearchFilters(
  filters: LegalSearchRequestFilters,
) {
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
  /** Response diagnostics.liveProviderSearched; undefined (pre-diagnostics
   * responses) reads as not-consulted so copy never claims more than the
   * response supports. */
  liveProviderSearched?: boolean
  /** 1-based count of queued polls so far, for the progress line. */
  hydrationAttempt?: number
  /** True once the bounded recheck gives up waiting. */
  hydrationExpired?: boolean
  /** Response diagnostics.legislationNote: the legislation half recognised a
   * citation but served nothing. Names what was asked for. */
  legislationNote?: string
  /** Response diagnostics.legislationNotHeld: an authoritative not-held
   * verdict, not an outage. */
  legislationNotHeld?: boolean
  /** Response diagnostics.legislationTitleUnresolved: a whole-title request no
   * exact title key matched. */
  legislationTitleUnresolved?: boolean
  /** Response diagnostics.legislationAmbiguous: more than one stored Act
   * satisfies the query. */
  legislationAmbiguous?: boolean
  /** Response diagnostics.legislationScheduleGuidance: a schedule citation
   * that names a paragraph but no schedule. The structured example and Act
   * context drive a corrective with a resubmission the parser accepts. */
  legislationScheduleGuidance?: LegislationScheduleGuidance
}) {
  const outcome =
    input.outcome ?? (input.hydrationQueued ? 'hydration_queued' : 'no_match')
  const liveSearched = input.liveProviderSearched === true

  // A held Act whose schedule citation names no schedule. A corrective, not a
  // not-held verdict: it must show the parser-compatible example with its Act
  // context rather than fall through to the generic judgment copy.
  if (input.legislationScheduleGuidance) {
    return getLegislationScheduleGuidanceFeedback(
      input.legislationScheduleGuidance,
    )
  }

  // The legislation half's honest negatives. Each rides its own flag, so a
  // terminal branch that answers no_match or hydration_queued still surfaces
  // the verdict, and the generic judgment copy below never stands in for it.
  // The not-held copy is reserved for an authoritative verdict (a chapter or
  // provision the store proves absent), never a failed title lookup.
  if (input.legislationNotHeld && input.legislationNote) {
    return {
      eyebrow: 'Legislation not held',
      title: 'No stored legislation matches this search',
      body: `${input.legislationNote} Nothing that merely shares words with the title is shown in its place.`,
    }
  }

  // A whole-title request the directory could not resolve. Say only what is
  // known: no exact title matched. Never claim the Act itself is absent, and
  // suppress the unrelated keyword provisions the exact path would otherwise
  // fall through to.
  if (input.legislationTitleUnresolved && input.legislationNote) {
    return {
      eyebrow: 'Legislation title not matched',
      title: 'No exact legislation title match',
      body: `${input.legislationNote} Try the chapter citation (for example "2010 c. 15") or the Act's exact short title.`,
    }
  }

  if (input.legislationAmbiguous && input.legislationNote) {
    return {
      eyebrow: 'Legislation ambiguous',
      title: 'More than one stored Act matches',
      body: `${input.legislationNote} Choose the Act you meant by its chapter citation.`,
    }
  }

  // Honest empty for a well-formed citation no source holds. Names the
  // citation so the failure reads as not-held rather than not-searched.
  // Signed-out (or otherwise stored-only) searches must not claim a
  // provider was consulted: the API gates live on session.
  if (outcome === 'recognised_not_held') {
    return {
      eyebrow: 'Citation not held',
      title: 'No judgment held for this citation',
      body: liveSearched
        ? `No stored or provider source holds "${input.query}" as a judgment. Check the citation or search party names instead.`
        : `No stored legal source holds "${input.query}" as a judgment. Providers were not consulted for this search. Check the citation or search party names instead.`,
    }
  }

  if (outcome === 'hydration_queued') {
    if (input.hydrationExpired) {
      return {
        eyebrow: 'Search queued',
        title: 'Still no match after rechecks',
        body: `Stored sources did not have "${input.query}" and rechecks of public legal sources found nothing new. Retry the search or refine the query.`,
      }
    }
    const attempt = Math.max(1, input.hydrationAttempt ?? 1)
    return {
      eyebrow: 'Search queued',
      title: 'Checking legal sources',
      body: `Stored sources did not yet have "${input.query}". Rechecking public legal sources automatically (check ${attempt} of ${LEGAL_SEARCH_HYDRATION_MAX_POLLS + 1}); results will appear without retyping.`,
    }
  }

  if (outcome === 'stored_browse_empty' || input.browse) {
    return {
      eyebrow: 'No stored cases',
      title: 'No recent cases found',
      body: `No recent stored cases found for ${input.browse?.courtLabel ?? 'the selected court'}.`,
    }
  }

  if (outcome === 'unsupported_source_type') {
    return {
      eyebrow: 'Unsupported search',
      title: 'This source type is not searchable yet',
      body: `Search currently covers judgments. Refine to a judgment search for "${input.query}".`,
    }
  }

  return {
    eyebrow: 'No indexed match',
    title: 'No sources found',
    body: liveSearched
      ? `Stored legal sources and Find Case Law did not match "${input.query}" with the selected filters.`
      : `Stored legal sources did not match "${input.query}" with the selected filters. Providers were not consulted for this search.`,
  }
}

export function shouldRunLegalSearch(query: string) {
  return query.trim().length > 0
}

export function shouldRunLegalSearchRequest(
  query: string,
  filters: LegalSearchRequestFilters,
) {
  return shouldRunLegalSearch(query) || Boolean(filters.court.trim())
}

export function getRecentLegalSearches(
  storage: Pick<Storage, 'getItem'> | undefined,
) {
  if (!storage) return []

  const storedSearches = storage.getItem(legalSearchRecentSearchesKey)
  if (!storedSearches) return []

  try {
    const parsedSearches = JSON.parse(storedSearches) as unknown
    if (!Array.isArray(parsedSearches)) return []

    return dedupeRecentLegalSearches(
      parsedSearches.filter(
        (search): search is string => typeof search === 'string',
      ),
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

  const recentSearches = dedupeRecentLegalSearches([
    query,
    ...getRecentLegalSearches(storage),
  ])
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
  const [, setRecentSearches] = useState(() =>
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage),
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

      const rows = searchResultRows(state.response)
      const resultCount = rows.length
      if (resultCount === 0) return

      const interactiveTarget = isInteractiveTarget(event.target)

      if (
        !interactiveTarget &&
        (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j')
      ) {
        event.preventDefault()
        setSelectedResultIndex((currentIndex) =>
          Math.min(currentIndex + 1, resultCount - 1),
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
        const selectedRow = rows[selectedResultIndex]
        if (!selectedRow) return

        event.preventDefault()
        if (selectedRow.kind === 'judgment') {
          void navigate(caseResultLocation(selectedRow.hit))
          return
        }
        if (!selectedRow.hit.labelPath) return
        void navigate(provisionResultLocation(selectedRow.hit))
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
    }

    const requestId = searchRequestId.current + 1
    searchRequestId.current = requestId
    cancelInFlightSearch()
    const requestAbortController = new AbortController()
    abortController.current = requestAbortController
    setState({ status: 'loading', query: trimmedQuery })
    setSelectedResultIndex(-1)

    try {
      const response = await fetch(apiUrl('/api/search/fetch'), {
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

      const body = (await response.json()) as LegalSearchFetchResponse
      if (searchRequestId.current !== requestId) return
      if (abortController.current === requestAbortController)
        abortController.current = null
      // Federated groups count as results: a legislation-only answer has
      // an empty judgment hits array by design, never interleaved into it.
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
      // Empty: carry liveProviderSearched so no_match copy never claims a
      // provider was consulted when the API stayed stored-only, and
      // legislationNote so an unheld Act is named rather than reported as a
      // missing judgment. A queued outcome rechecks on a bound (timer-driven
      // from this handler, not a fetching effect) and expires plainly at the
      // bound instead of spinning forever.
      const liveProviderSearched = body.diagnostics?.liveProviderSearched
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
          liveProviderSearched,
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
        liveProviderSearched,
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

  // A corrective resubmission changes the search, so it must change the
  // command bar with it: results for the suggested citation beside the
  // original underspecified one leave Enter in the input rerunning the stale
  // query. runSearch is passed the query explicitly, so syncing the input
  // here starts no second request.
  function resubmitQuery(nextQuery: string) {
    setQuery(nextQuery)
    void runSearch(nextQuery)
  }

  function handleCourtShortcut(nextCourt: string) {
    const nextFilters = { court: nextCourt, dateFrom, dateTo }
    setCourt(nextCourt)
    setState(getLegalSearchStateAfterInputChange())
    setSelectedResultIndex(-1)
    scheduleAutoSearch(query, nextFilters)
  }

  const courtLabel = getCourtLabel(court)
  const scheduleResubmitQuery =
    state.status === 'empty' && state.legislationScheduleGuidance
      ? getLegislationScheduleResubmitQuery(state.legislationScheduleGuidance)
      : null
  const activeFilterCount = countActiveLegalSearchFilters({
    court,
    dateFrom,
    dateTo,
  })
  const shouldShowIdleState =
    state.status === 'idle' && !shouldRunLegalSearch(query)

  return (
    <div
      className={
        shouldShowIdleState
          ? 'flex h-full min-h-[24rem] flex-col items-center justify-center px-6 py-10'
          : 'flex h-full min-h-[24rem] flex-col'
      }
    >
      <div
        className={
          shouldShowIdleState
            ? 'flex w-full max-w-2xl flex-col gap-8'
            : 'flex min-h-0 w-full flex-1 flex-col'
        }
      >
        {shouldShowIdleState ? (
          <div className="flex flex-col gap-2 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Search judgments
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              Search stored judgments and Find Case Law across UK courts. Recent
              queries stay in the sidebar.
            </p>
          </div>
        ) : null}

        <SearchCommandBar
          activeFilterCount={activeFilterCount}
          courtLabel={courtLabel}
          dateFrom={dateFrom}
          dateTo={dateTo}
          inputRef={searchInputRef}
          isSearching={state.status === 'loading'}
          placement={shouldShowIdleState ? 'center' : 'top'}
          onFilterClick={() => setFiltersOpen(true)}
          onQueryChange={handleQueryChange}
          onRemoveFilter={removeFilter}
          onSubmit={handleSubmit}
          query={query}
        />

        {shouldShowIdleState ? (
          <SearchIdleExtras
            courtLabel={courtLabel}
            courtShortcuts={courtShortcuts}
            onCourtShortcut={handleCourtShortcut}
          />
        ) : state.status === 'results' ? (
          <SearchResults
            response={state.response}
            browse={state.browse}
            selectedIndex={selectedResultIndex}
            onSelectIndex={setSelectedResultIndex}
            onResubmit={resubmitQuery}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-6">
              {state.status === 'loading' ? (
                <p className="text-sm text-muted" role="status">
                  Searching…
                </p>
              ) : null}

              {state.status === 'empty' ? (
                <SearchFeedbackPanel
                  {...getLegalSearchEmptyFeedback({
                    query: state.query,
                    outcome: state.outcome,
                    hydrationQueued: state.hydrationQueued,
                    browse: state.browse,
                    liveProviderSearched: state.liveProviderSearched,
                    legislationNote: state.legislationNote,
                    legislationNotHeld: state.legislationNotHeld,
                    legislationTitleUnresolved:
                      state.legislationTitleUnresolved,
                    legislationAmbiguous: state.legislationAmbiguous,
                    legislationScheduleGuidance:
                      state.legislationScheduleGuidance,
                    hydrationAttempt: state.hydrationAttempt,
                    hydrationExpired: state.hydrationExpired,
                  })}
                  action={
                    scheduleResubmitQuery
                      ? {
                          label: 'Use this citation',
                          onClick: () => resubmitQuery(scheduleResubmitQuery),
                        }
                      : state.outcome === 'hydration_queued'
                        ? {
                            label: state.hydrationExpired
                              ? 'Retry search'
                              : 'Retry now',
                            onClick: () => void runSearch(state.query),
                          }
                        : undefined
                  }
                  tone="warning"
                />
              ) : null}

              {state.status === 'error' ? (
                <SearchFeedbackPanel
                  action={{
                    label: 'Retry search',
                    onClick: () => void runSearch(state.query),
                  }}
                  eyebrow="Search error"
                  title="Search could not complete"
                  body={state.message}
                  tone="error"
                />
              ) : null}
            </div>
          </div>
        )}
      </div>

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
    </div>
  )
}

/**
 * Names the failure the API reported so the error panel never shows a
 * generic message for a specific outage. The error code is read from the
 * body, not the status alone: 503 covers both the search index and Find
 * Case Law, and only the code says which one is down.
 */
async function readSearchErrorMessage(response: Response): Promise<string> {
  if (response.status === 429) {
    return 'Search is busy fetching new results. Try again shortly.'
  }
  if (response.status !== 503) {
    return 'Search could not complete the request.'
  }
  const code = await response
    .json()
    .then(
      (body: unknown) =>
        (body as { error?: { code?: unknown } } | null)?.error?.code,
    )
    .catch(() => undefined)
  return code === 'search_unavailable'
    ? 'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.'
    : 'Find Case Law is currently unreachable. Cached results may still be available through standard search.'
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

  const query =
    window.sessionStorage.getItem('obiter.search.initialQuery') ?? ''
  window.sessionStorage.removeItem('obiter.search.initialQuery')
  return query
}
