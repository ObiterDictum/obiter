import { Link } from '@tanstack/react-router'
import { buttonClassName } from '@obiter/ui'
import { formatDate } from '../../format'
import { provisionResultLocation } from '../../legislation-navigation'
import { legislationStatusDisplay } from '../../legislation-status'
import type { LegislationSearchResultHit } from './searchTypes'

export function ActSearchDetails({ hit }: { hit: LegislationSearchResultHit }) {
  const act = hit.act
  return (
    <div className="flex flex-col gap-3 text-meta text-muted">
      <ul aria-label="Act details" className="flex flex-wrap gap-x-4 gap-y-1">
        <li>{hit.provisionLabel}</li>
        <li>{hit.extent || 'Extent not recorded'}</li>
        <li>
          {act?.enactmentDate
            ? `Royal Assent ${formatDate(act.enactmentDate)}`
            : 'Enactment date not recorded'}
        </li>
        {act ? (
          <>
            <li>
              {act.status === 'repealed'
                ? legislationStatusDisplay('repealed', act.repealedFrom).label
                : 'In force'}
            </li>
            <li>
              {act.totalCount}{' '}
              {act.totalCount === 1 ? 'provision' : 'provisions'} ·{' '}
              {act.withheldCount} withheld
            </li>
          </>
        ) : null}
      </ul>
      {act?.outline.length ? (
        <ul
          aria-label="Act outline"
          className="flex flex-col gap-1 border-l border-line pl-3"
        >
          {act.outline.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function ActSearchActions({ hit }: { hit: LegislationSearchResultHit }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        {...provisionResultLocation(hit)}
        className={buttonClassName({ variant: 'primary', size: 'sm' })}
      >
        Read the Act
      </Link>
      <a
        href={hit.officialUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-meta text-muted underline underline-offset-2"
      >
        legislation.gov.uk
      </a>
    </div>
  )
}
