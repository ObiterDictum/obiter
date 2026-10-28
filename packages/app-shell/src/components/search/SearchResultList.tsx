import { Link } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { Button, StatusDot } from '@obiter/ui'
import { caseResultLocation } from '../../case-navigation'
import { formatDate } from '../../format'
import { provisionResultLocation } from '../../legislation-navigation'
import {
  JudgmentExtractProvenance,
  LegislationExtractProvenance,
  SearchSnippet,
} from './SearchSnippet'
import { judgmentIsHeld } from './provenance'
import type { SearchResultRow } from './searchResultRows'
import { getReadableCourtLabel } from './searchTypes'

export function SearchResultList({
  rows,
  selectedIndex,
  onSelectIndex,
  onPreview,
}: {
  rows: SearchResultRow[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  onPreview: (index: number) => void
}) {
  return (
    <ul
      className="divide-y divide-line overflow-hidden rounded-lg bg-surface"
      aria-label="Search results"
    >
      {rows.map((row, index) => (
        <li key={`${row.kind}-${row.hit.id}`}>
          {row.kind === 'judgment' ? (
            <JudgmentResult
              row={row}
              index={index}
              selected={selectedIndex === index}
              onSelect={() => onSelectIndex(index)}
              onPreview={() => onPreview(index)}
            />
          ) : (
            <LegislationResult
              row={row}
              index={index}
              selected={selectedIndex === index}
              onSelect={() => onSelectIndex(index)}
              onPreview={() => onPreview(index)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function JudgmentResult({
  row,
  index,
  selected,
  onSelect,
  onPreview,
}: {
  row: Extract<SearchResultRow, { kind: 'judgment' }>
  index: number
  selected: boolean
  onSelect: () => void
  onPreview: () => void
}) {
  const hit = row.hit
  const snippet = hit.snippets?.[0]
  return (
    <article
      aria-current={selected ? 'true' : undefined}
      data-result-index={index}
      data-current={selected ? 'true' : undefined}
      className="p-6 data-[current=true]:bg-raised"
      onFocus={onSelect}
      onMouseEnter={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="min-w-0 text-item leading-snug">
          <Link
            {...caseResultLocation(hit)}
            className="italic text-ink underline-offset-2 hover:underline"
          >
            {hit.title}
          </Link>
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="compact:hidden"
            onClick={onPreview}
          >
            Preview
          </Button>
          <Link
            {...caseResultLocation(hit)}
            aria-label={`Open ${hit.title}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink"
          >
            <ArrowRight aria-hidden size={16} />
          </Link>
        </div>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-meta text-subtle">
        <span>{hit.neutralCitation ?? 'No neutral citation'}</span>
        <span aria-hidden>·</span>
        <span>{getReadableCourtLabel(hit.court)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDate(hit.dateDecided)}</span>
      </p>
      {snippet ? (
        <>
          <SearchSnippet snippet={snippet} className="mt-3 max-w-[68ch]" />
          <JudgmentExtractProvenance hit={hit} snippet={snippet} />
        </>
      ) : (
        <p className="mt-3 text-meta text-muted">
          No extracted text for this result. Open the judgment to read the
          source.
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-caption text-subtle">
        <span>{judgmentIsHeld(hit) ? 'Stored source' : 'Source record'}</span>
        <Link
          {...caseResultLocation(hit)}
          className="text-ink underline-offset-2 hover:underline"
        >
          Open judgment
        </Link>
      </div>
    </article>
  )
}

function LegislationResult({
  row,
  index,
  selected,
  onSelect,
  onPreview,
}: {
  row: Extract<SearchResultRow, { kind: 'legislation' }>
  index: number
  selected: boolean
  onSelect: () => void
  onPreview: () => void
}) {
  const hit = row.hit
  const withheld = hit.legislationStatus === 'amended_not_held'
  const extract = hit.snippets?.[0]?.text ?? hit.text
  return (
    <article
      aria-current={selected ? 'true' : undefined}
      data-result-index={index}
      data-current={selected ? 'true' : undefined}
      className="p-6 data-[current=true]:bg-raised"
      onFocus={onSelect}
      onMouseEnter={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="min-w-0 text-item leading-snug">
          <Link
            {...provisionResultLocation(hit)}
            className="text-ink underline-offset-2 hover:underline"
          >
            {hit.provisionLabel} · {hit.title}
          </Link>
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="compact:hidden"
            onClick={onPreview}
          >
            Preview
          </Button>
          <Link
            {...provisionResultLocation(hit)}
            aria-label={`Open ${hit.provisionLabel} ${hit.title}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink"
          >
            <ArrowRight aria-hidden size={16} />
          </Link>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-subtle">
        <span>{hit.extent ? hit.extent : 'Extent not recorded'}</span>
        <span aria-hidden>·</span>
        <StatusDot tone={withheld ? 'warning' : 'success'}>
          {withheld ? 'Amended wording withheld' : 'No unapplied amendments'}
        </StatusDot>
      </div>
      {extract ? (
        <>
          <p className="mt-3 max-w-[68ch] text-meta leading-relaxed text-muted">
            {extract}
          </p>
          <LegislationExtractProvenance hit={hit} />
        </>
      ) : (
        <p className="mt-3 text-meta text-muted">{hit.notice}</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-caption text-subtle">
        <span>legislation.gov.uk</span>
        <Link
          {...provisionResultLocation(hit)}
          className="text-ink underline-offset-2 hover:underline"
        >
          Open provision
        </Link>
      </div>
    </article>
  )
}
