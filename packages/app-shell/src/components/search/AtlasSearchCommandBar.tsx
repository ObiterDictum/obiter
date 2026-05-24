import { type FormEvent } from 'react'

interface AtlasSearchCommandBarProps {
  activeFilterCount: number
  courtLabel: string
  dateFrom: string
  dateTo: string
  onFilterClick: () => void
  onQueryChange: (query: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  query: string
}

export function AtlasSearchCommandBar({
  activeFilterCount,
  courtLabel,
  dateFrom,
  dateTo,
  onFilterClick,
  onQueryChange,
  onSubmit,
  query,
}: AtlasSearchCommandBarProps) {
  return (
    <form className="atlas-search__form" onSubmit={onSubmit}>
      <div className="atlas-search__form-header">
        <span>Search legal sources</span>
        <button className="atlas-search__filters-button" type="button" onClick={onFilterClick}>
          <span>Filters</span>
          {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
        </button>
      </div>
      <div className="atlas-search__primary atlas-search__primary--input-only">
        <label className="atlas-search__field">
          <span className="atlas-search__visually-hidden">Search legal sources</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Potanina"
            name="query"
            type="search"
          />
        </label>
      </div>
      {activeFilterCount > 0 ? (
        <div className="atlas-search__active-filters" aria-label="Active filters">
          {courtLabel !== 'All courts and tribunals' ? <span>{courtLabel}</span> : null}
          {dateFrom ? <span>From {dateFrom}</span> : null}
          {dateTo ? <span>To {dateTo}</span> : null}
        </div>
      ) : null}
    </form>
  )
}
