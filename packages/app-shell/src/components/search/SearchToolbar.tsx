import { Button } from '@obiter/ui'
import type { SearchResultType } from './searchResultRows'
import { getCourtLabel } from './searchTypes'

export function SearchToolbar({
  summary,
  court,
  dateFrom,
  dateTo,
  type,
  onRemoveCourt,
  onRemoveDateFrom,
  onRemoveDateTo,
  onRemoveType,
  onClear,
}: {
  summary: string
  court: string
  dateFrom: string
  dateTo: string
  type: SearchResultType
  onRemoveCourt: () => void
  onRemoveDateFrom: () => void
  onRemoveDateTo: () => void
  onRemoveType: () => void
  onClear: () => void
}) {
  const hasFilters = Boolean(court || dateFrom || dateTo || type !== 'all')
  return (
    <div className="flex flex-wrap items-center gap-2">
      {court ? (
        <FilterChip
          label={getCourtLabel(court)}
          removeLabel={`Remove ${getCourtLabel(court)} filter`}
          onRemove={onRemoveCourt}
        />
      ) : null}
      {dateFrom ? (
        <FilterChip
          label={`From ${dateFrom}`}
          removeLabel={`Remove from ${dateFrom} filter`}
          onRemove={onRemoveDateFrom}
        />
      ) : null}
      {dateTo ? (
        <FilterChip
          label={`To ${dateTo}`}
          removeLabel={`Remove to ${dateTo} filter`}
          onRemove={onRemoveDateTo}
        />
      ) : null}
      {type !== 'all' ? (
        <FilterChip
          label={type === 'judgments' ? 'Case law' : 'Legislation'}
          removeLabel="Remove type filter"
          onRemove={onRemoveType}
        />
      ) : null}
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear all
        </Button>
      ) : null}
      <span className="ml-auto text-meta text-subtle">{summary}</span>
    </div>
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
    <span className="inline-flex items-center gap-1 rounded-md bg-fill px-2 py-1 text-caption text-ink">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        className="inline-flex size-4 items-center justify-center rounded-sm text-subtle hover:text-ink"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}
