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
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 transition-colors focus-within:border-brand">
        <MagnifyingGlass aria-hidden="true" size={18} className="shrink-0 text-subtle" />
        <label className="sr-only">Search legal sources</label>
        <input
          ref={inputRef}
          className="min-h-[48px] flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Case name, neutral citation, or keyword — e.g. Potanina"
          name="query"
          type="search"
          autoFocus
        />
        <button
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-pressed disabled:cursor-progress disabled:opacity-70"
          type="submit"
          disabled={isSearching}
        >
          {isSearching ? 'Searching' : 'Search'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink"
          type="button"
          onClick={onFilterClick}
        >
          <Funnel aria-hidden="true" size={13} weight="bold" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-brand px-1 text-[10px] font-bold text-brand-fg">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
        {courtLabel !== 'All courts and tribunals' ? (
          <FilterChip label={courtLabel} removeLabel={`Remove ${courtLabel} filter`} onRemove={() => onRemoveFilter('court')} />
        ) : null}
        {dateFrom ? (
          <FilterChip label={`From ${dateFrom}`} removeLabel={`Remove from ${dateFrom} filter`} onRemove={() => onRemoveFilter('dateFrom')} />
        ) : null}
        {dateTo ? (
          <FilterChip label={`To ${dateTo}`} removeLabel={`Remove to ${dateTo} filter`} onRemove={() => onRemoveFilter('dateTo')} />
        ) : null}
      </div>

      {isSearching ? (
        <div className="inline-flex items-center gap-2 text-sm font-medium text-muted" role="status">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-pill bg-brand" />
          Searching legal sources
        </div>
      ) : null}
    </form>
  )
}

function FilterChip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-brand/40 bg-brand/5 px-2.5 py-1 text-xs font-semibold text-brand">
      {label}
      <button
        aria-label={removeLabel}
        type="button"
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-pill text-brand/70 transition-colors hover:bg-brand/10 hover:text-brand"
        onClick={onRemove}
      >
        <X aria-hidden="true" size={11} weight="bold" />
      </button>
    </span>
  )
}
