import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowSquareOut,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@obiter/ui'
import { provisionResultLocation } from '../../legislation-navigation'
import type { LegislationSearchResultHit } from './searchTypes'

export function LegislationHit({
  hit,
  selected,
  onSelect,
}: {
  hit: LegislationSearchResultHit
  selected?: boolean
  onSelect?: () => void
}) {
  const withheld = hit.legislationStatus === 'amended_not_held'
  const isProvision = Boolean(hit.labelPath)

  if (!isProvision) {
    // Act-level hit: link through to the Act contents page instead of
    // asking for a section number. provisionResultLocation already maps
    // an empty labelPath to /ln/{identity}.
    const location = provisionResultLocation(hit)
    return (
      <Link
        {...location}
        data-legislation-status="current"
        className={
          selected
            ? 'group flex items-start justify-between gap-4 rounded-md bg-raised px-3 py-3 text-ink transition-colors'
            : 'group flex items-start justify-between gap-4 rounded-md px-3 py-3 text-ink transition-colors hover:bg-raised'
        }
        onFocus={onSelect}
        onMouseEnter={onSelect}
      >
        <CurrentLegislationBody hit={hit} />
        <ArrowRight
          aria-hidden
          size={16}
          className="mt-0.5 shrink-0 text-subtle transition-colors group-hover:text-ink"
        />
      </Link>
    )
  }

  const location = provisionResultLocation(hit)
  if (withheld) {
    // One warning surface: amber frame + #174 badge. The list item is unstyled
    // so this card is not nested inside a second withheld treatment.
    return (
      <article
        className={
          selected
            ? 'rounded-md border border-warning/50 bg-warning/15 px-3 py-3 text-ink transition-colors'
            : 'rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-ink transition-colors hover:bg-warning/15'
        }
        data-legislation-status="amended_not_held"
      >
        <Link
          {...location}
          className="block text-ink"
          onFocus={onSelect}
          onMouseEnter={onSelect}
        >
          <span className="mb-1.5 block">
            <Badge tone="warning">
              <WarningCircle size={13} aria-hidden />
              Amended wording withheld
            </Badge>
          </span>
          <strong className="block text-sm font-medium leading-snug">
            {hit.provisionLabel} · {hit.title}
          </strong>
          <span className="mt-1 block text-[12px] text-muted">
            {hit.notice}
          </span>
          <LegislationMeta hit={hit} />
        </Link>
        <a
          href={hit.officialUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-warning underline decoration-warning/40 underline-offset-2"
        >
          Read the official revised provision
          <ArrowSquareOut aria-hidden size={12} />
        </a>
      </article>
    )
  }

  return (
    <Link
      {...location}
      data-legislation-status="current"
      className={
        selected
          ? 'group flex items-start justify-between gap-4 rounded-md bg-raised px-3 py-3 text-ink transition-colors'
          : 'group flex items-start justify-between gap-4 rounded-md px-3 py-3 text-ink transition-colors hover:bg-raised'
      }
      onFocus={onSelect}
      onMouseEnter={onSelect}
    >
      <CurrentLegislationBody hit={hit} />
      <ArrowRight
        aria-hidden
        size={16}
        className="mt-0.5 shrink-0 text-subtle transition-colors group-hover:text-ink"
      />
    </Link>
  )
}

function CurrentLegislationBody({ hit }: { hit: LegislationSearchResultHit }) {
  return (
    <span className="block min-w-0 flex-1">
      <strong className="block text-sm font-medium leading-snug">
        {hit.provisionLabel} · {hit.title}
      </strong>
      {hit.notice ? (
        <span className="mt-1 block text-[12px] text-muted">{hit.notice}</span>
      ) : null}
      {(hit.snippets?.[0]?.text ?? hit.text) ? (
        <span className="mt-1 block text-[12px] text-muted">
          {hit.snippets?.[0]?.text ?? hit.text}
        </span>
      ) : null}
      <LegislationMeta hit={hit} />
    </span>
  )
}

function LegislationMeta({ hit }: { hit: LegislationSearchResultHit }) {
  return (
    <small className="mt-1 block text-[11px] text-subtle">
      {hit.extent ? `${hit.extent} · ` : ''}
      legislation.gov.uk
    </small>
  )
}
