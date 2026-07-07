import { type FormEvent, type RefObject } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'

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
    <form className="legal-search__form" onSubmit={onSubmit}>
      <div className="legal-search__form-header">
        <span>Search legal sources</span>
        <button className="legal-search__filters-button" type="button" onClick={onFilterClick}>
          <span>Filters</span>
          {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
        </button>
      </div>
      <div className="legal-search__primary">
        <label className="legal-search__field">
          <span className="legal-search__visually-hidden">Search legal sources</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Potanina"
            name="query"
            type="search"
          />
        </label>
        <button className="legal-search__submit" type="submit" disabled={isSearching}>
          <MagnifyingGlass aria-hidden="true" />
          <span>Search</span>
        </button>
      </div>
      {isSearching ? (
        <div className="legal-search__inline-status" role="status">
          <span aria-hidden="true" />
          Searching legal sources
        </div>
      ) : null}
      {activeFilterCount > 0 ? (
        <div className="legal-search__active-filters" aria-label="Active filters">
          {courtLabel !== 'All courts and tribunals' ? (
            <span>
              {courtLabel}
              <button
                aria-label={`Remove ${courtLabel} filter`}
                type="button"
                onClick={() => onRemoveFilter('court')}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {dateFrom ? (
            <span>
              From {dateFrom}
              <button
                aria-label={`Remove from ${dateFrom} filter`}
                type="button"
                onClick={() => onRemoveFilter('dateFrom')}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {dateTo ? (
            <span>
              To {dateTo}
              <button
                aria-label={`Remove to ${dateTo} filter`}
                type="button"
                onClick={() => onRemoveFilter('dateTo')}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
