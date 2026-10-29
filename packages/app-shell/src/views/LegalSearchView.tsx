import { SidePanel } from '@obiter/ui'
import { ContentFrame } from '../content-frame'
import {
  SearchCommandBar,
  SearchFacets,
  SearchFeedbackPanel,
  SearchKeyboardShortcuts,
  SearchLanding,
  SearchNotices,
  SearchPreview,
  SearchResultList,
  SearchToolbar,
  courtOptionGroups,
  getCourtLabel,
} from '../components/search'
import { formatResultSummary } from '../components/search/searchResultRows'
import { useLegalSearch } from '../legal-search-controller'
import {
  countActiveLegalSearchFilters,
  getLegalSearchElsewhereLinks,
  getLegalSearchEmptyFeedback,
} from '../legal-search-state'

export {
  LEGAL_SEARCH_DEBOUNCE_MS,
  LEGAL_SEARCH_HYDRATION_MAX_POLLS,
  LEGAL_SEARCH_HYDRATION_POLL_MS,
  countActiveLegalSearchFilters,
  createLegalSearchFetchRequest,
  getLegalSearchElsewhereLinks,
  getLegalSearchEmptyFeedback,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  shouldRunLegalSearch,
  shouldRunLegalSearchRequest,
  type LegalSearchFetchRequest,
} from '../legal-search-state'
export { courtOptionGroups, getCourtLabel }

export {
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
} from '../legal-search-selection'

const courtShortcuts = [
  { code: 'uksc', label: 'UKSC' },
  { code: 'ewca/civ', label: 'EWCA Civ' },
  { code: 'ewhc/admin', label: 'EWHC Admin' },
]

export function LegalSearchView() {
  const {
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
    setTypeFilter,
  } = useLegalSearch()
  const activeFilterCount = countActiveLegalSearchFilters(filters)

  return (
    <ContentFrame className="flex flex-col gap-6 py-14">
      <header className="flex flex-col gap-6">
        <div className="min-w-0">
          <h1 className="text-page text-ink">Search</h1>
          <p className="mt-2 max-w-[68ch] text-body text-muted">
            UK case law and legislation. Every result links to the source.
          </p>
        </div>
        <SearchCommandBar
          inputRef={searchInputRef}
          isSearching={state.status === 'loading'}
          onClear={clearQuery}
          onQueryChange={handleQueryChange}
          onSubmit={handleSubmit}
          query={query}
        />
      </header>

      {shouldShowIdleState ? (
        <SearchLanding
          courtLabel={courtLabel}
          courtShortcuts={courtShortcuts}
          recentSearches={recentSearches}
          onClearRecents={clearRecents}
          onCourtShortcut={handleCourtShortcut}
          onRecentSearch={handleRecentSearch}
        />
      ) : state.status === 'results' ? (
        <>
          <SearchToolbar
            court={court}
            dateFrom={dateFrom}
            dateTo={dateTo}
            summary={formatResultSummary(state.response, state.browse)}
            type={typeFilter}
            onClear={clearFilters}
            onRemoveCourt={() => removeFilter('court')}
            onRemoveDateFrom={() => removeFilter('dateFrom')}
            onRemoveDateTo={() => removeFilter('dateTo')}
            onRemoveType={clearTypeFilter}
          />
          <div className="grid grid-cols-[196px_minmax(0,1fr)] items-start gap-6 max-md:grid-cols-1 wide:grid-cols-[216px_minmax(0,1fr)_340px]">
            <div className="hidden md:block">
              <SearchFacets
                response={state.response}
                filters={filters}
                type={typeFilter}
                onTypeChange={(nextType) => {
                  setTypeFilter(nextType)
                  setSelectedResultIndex(0)
                }}
                onFiltersChange={applyFilters}
                onClear={clearFilters}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <SearchNotices
                response={state.response}
                onResubmit={resubmitQuery}
              />
              {rows.length > 0 ? (
                <SearchResultList
                  rows={rows}
                  selectedIndex={selectedResultIndex}
                  onSelectIndex={setSelectedResultIndex}
                  onPreview={(index) => {
                    setSelectedResultIndex(index)
                    setPreviewOpen(true)
                  }}
                />
              ) : (
                <SearchFeedbackPanel
                  eyebrow="Type filter"
                  title="No results of this type"
                  body="This search has no results of the selected type. Show all results, or widen the query."
                  action={{
                    label: 'Show all results',
                    onClick: clearTypeFilter,
                  }}
                />
              )}
            </div>
            <aside className="hidden wide:block">
              <SearchPreview row={selectedRow} />
            </aside>
          </div>
        </>
      ) : (
        <div className="w-full">
          {state.status === 'loading' ? (
            <p className="text-body text-muted" role="status">
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
                legislationNote: state.legislationNote,
                legislationNotHeld: state.legislationNotHeld,
                legislationTitleUnresolved: state.legislationTitleUnresolved,
                legislationAmbiguous: state.legislationAmbiguous,
                legislationScheduleGuidance: state.legislationScheduleGuidance,
                hydrationAttempt: state.hydrationAttempt,
                hydrationExpired: state.hydrationExpired,
                filtersActive: activeFilterCount > 0,
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
                    : activeFilterCount > 0
                      ? {
                          label: 'Clear filters',
                          onClick: clearFilters,
                        }
                      : undefined
              }
              searchLinks={getLegalSearchElsewhereLinks(state.query)}
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
      )}

      <SidePanel
        open={previewOpen && state.status === 'results'}
        onOpenChange={setPreviewOpen}
        title="Result preview"
      >
        <SearchPreview row={selectedRow} embedded />
      </SidePanel>

      {shortcutsOpen ? (
        <SearchKeyboardShortcuts onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </ContentFrame>
  )
}
