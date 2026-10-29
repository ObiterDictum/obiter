import { useState } from 'react'
import { Button, DatePicker } from '@obiter/ui'
import { getReadableCourtLabel } from './searchTypes'
import {
  filterSearchResultRows,
  searchResultRows,
  type SearchResultType,
} from './searchResultRows'
import type {
  LegalSearchFetchResponse,
  LegalSearchRequestFilters,
} from './searchTypes'

export interface SearchFacetsProps {
  response: LegalSearchFetchResponse
  filters: LegalSearchRequestFilters
  type: SearchResultType
  onTypeChange: (type: SearchResultType) => void
  onFiltersChange: (filters: LegalSearchRequestFilters) => void
  onClear: () => void
}

export function SearchFacets({
  response,
  filters,
  type,
  onTypeChange,
  onFiltersChange,
  onClear,
}: SearchFacetsProps) {
  const rows = searchResultRows(response)
  const judgments = filterSearchResultRows(rows, 'judgments')
  const legislation = filterSearchResultRows(rows, 'legislation')
  const courts = courtCounts(response.hits.map((hit) => hit.court))
  if (filters.court && !courts.includes(filters.court)) {
    courts.push(filters.court)
  }
  const hasFilters = Boolean(
    filters.court || filters.dateFrom || filters.dateTo || type !== 'all',
  )
  const [showAllCourts, setShowAllCourts] = useState(false)
  const visibleCourts = showAllCourts ? courts : courts.slice(0, 5)
  const shownCourts =
    filters.court && !visibleCourts.includes(filters.court)
      ? [filters.court, ...visibleCourts]
      : visibleCourts

  return (
    <aside aria-label="Filters" className="flex min-w-0 flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section text-ink">Filters</h2>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-meta text-subtle">Type</legend>
        {(
          [
            ['all', 'All results', rows.length],
            ['judgments', 'Case law', judgments.length],
            ['legislation', 'Legislation', legislation.length],
          ] as const
        ).map(([value, label, count]) => (
          <label
            key={value}
            className="flex min-h-8 cursor-pointer items-center gap-2 text-body text-ink"
          >
            <input
              type="radio"
              name="search-type"
              value={value}
              checked={type === value}
              disabled={count === 0 && value !== 'all'}
              onChange={() => onTypeChange(value)}
              className="size-4 accent-brand"
            />
            <span className="flex-1">{label}</span>
            <span className="text-caption text-subtle tabular-nums">
              {count}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-meta text-subtle">Court</legend>
        <CourtFacet
          value={filters.court}
          courts={shownCourts}
          onChange={(court) => onFiltersChange({ ...filters, court })}
        />
        {courts.length > 5 ? (
          <button
            type="button"
            className="w-fit text-caption text-muted hover:text-ink"
            onClick={() => setShowAllCourts((shown) => !shown)}
          >
            {showAllCourts
              ? 'Show fewer courts'
              : `Show ${courts.length - visibleCourts.length} more courts`}
          </button>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-meta text-subtle">Date decided</legend>
        <DatePicker
          label="From"
          value={filters.dateFrom}
          name="search-date-from"
          onChange={(dateFrom) => onFiltersChange({ ...filters, dateFrom })}
        />
        <DatePicker
          label="To"
          value={filters.dateTo}
          name="search-date-to"
          onChange={(dateTo) => onFiltersChange({ ...filters, dateTo })}
        />
      </fieldset>
    </aside>
  )
}

function CourtFacet({
  value,
  courts,
  onChange,
}: {
  value: string
  courts: string[]
  onChange: (court: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-8 cursor-pointer items-center gap-2 text-body text-ink">
        <input
          type="radio"
          name="search-court"
          value=""
          checked={value === ''}
          onChange={() => onChange('')}
          className="size-4 accent-brand"
        />
        All courts and tribunals
      </label>
      {courts.map((court) => (
        <label
          key={court}
          className="flex min-h-8 cursor-pointer items-center gap-2 text-body text-ink"
        >
          <input
            type="radio"
            name="search-court"
            value={court}
            checked={value === court}
            onChange={() => onChange(court)}
            className="size-4 accent-brand"
          />
          {getReadableCourtLabel(court)}
        </label>
      ))}
    </div>
  )
}

function courtCounts(courts: string[]) {
  const counts = new Map<string, number>()
  for (const court of courts) counts.set(court, (counts.get(court) ?? 0) + 1)
  return [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        getReadableCourtLabel(a[0]).localeCompare(getReadableCourtLabel(b[0])),
    )
    .map(([court]) => court)
}
