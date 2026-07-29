import { type FormEvent, type RefObject } from 'react'
import { Funnel, MagnifyingGlass, X } from '@phosphor-icons/react'

interface SearchCommandBarProps {
  activeFilterCount: number
  courtLabel: string
  dateFrom: string
  dateTo: string
  isSearching: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onFilterClick: () => void
  onQueryChange: (query: string) => void
  onRemoveFilter: (filter: 'court' | 'dateFrom' | 'dateTo') => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  query: string
}

export function SearchCommandBar({
  activeFilterCount,
  courtLabel,
  dateFrom,
  dateTo,
  isSearching,
  inputRef,
  onFilterClick,
  onQueryChange,
  onRemoveFilter,
  onSubmit,
  query,
}: SearchCommandBarProps) {
  return (
    <form
      className="flex shrink-0 flex-col border-b border-line"
      onSubmit={onSubmit}
    >
      <div className="flex items-center gap-2 px-4 py-2 sm:px-5">
        <MagnifyingGlass
          aria-hidden="true"
          size={16}
          className="shrink-0 text-subtle"
        />
        <label className="sr-only" htmlFor="legal-sources-search">
          Search legal sources
        </label>
        <input
          ref={inputRef}
          id="legal-sources-search"
          className="min-h-[36px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Act, citation, party, or point of law"
          name="query"
          type="search"
          autoFocus
        />
        <button
          className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-progress disabled:opacity-70"
          type="submit"
          disabled={isSearching}
        >
          {isSearching ? 'Searching…' : 'Search'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 sm:px-5">
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
          type="button"
          onClick={onFilterClick}
        >
          <Funnel aria-hidden="true" size={13} weight="bold" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-brand px-1 text-[10px] font-bold text-brand-fg">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
        {courtLabel !== 'All courts and tribunals' ? (
          <FilterChip
            label={courtLabel}
            removeLabel={`Remove ${courtLabel} filter`}
            onRemove={() => onRemoveFilter('court')}
          />
        ) : null}
        {dateFrom ? (
          <FilterChip
            label={`From ${dateFrom}`}
            removeLabel={`Remove from ${dateFrom} filter`}
            onRemove={() => onRemoveFilter('dateFrom')}
          />
        ) : null}
        {dateTo ? (
          <FilterChip
            label={`To ${dateTo}`}
            removeLabel={`Remove to ${dateTo} filter`}
            onRemove={() => onRemoveFilter('dateTo')}
          />
        ) : null}
        {isSearching ? (
          <span
            className="inline-flex items-center gap-2 text-xs font-medium text-muted"
            role="status"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-pill bg-brand"
            />
            Searching legal sources
          </span>
        ) : null}
      </div>
    </form>
  )
}

function FilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string
  removeLabel: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-xs font-medium text-ink">
      {label}
      <button
        aria-label={removeLabel}
        type="button"
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
        onClick={onRemove}
      >
        <X aria-hidden="true" size={11} weight="bold" />
      </button>
    </span>
  )
}
