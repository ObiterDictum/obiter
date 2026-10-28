import { Card, CardBody, CardHead, StatusDot } from '@obiter/ui'
import { Link } from '@tanstack/react-router'
import { buttonClassName } from '@obiter/ui'
import { formatDate } from '../format'
import type { MatterRecord } from '../matters'
import { openWorkParts, type MatterOpenWork } from './matters-rows'

/**
 * The matter's details and what is waiting in it. Facts come from the matter
 * record; open work is the same attention items Home ranks, counted for this
 * matter alone, so the rail and the queue never disagree.
 */
export function MatterOverview({
  matter,
  openWork,
  openWorkUnavailable,
}: {
  matter: MatterRecord
  openWork: MatterOpenWork | null
  openWorkUnavailable: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card aria-labelledby="matter-details">
        <CardHead title="Matter details" titleId="matter-details" />
        <CardBody>
          <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta">
            {factsOf(matter).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-subtle">{label}</dt>
                <dd className="min-w-0 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card aria-labelledby="matter-open-work">
        <CardHead title="Open work" titleId="matter-open-work" />
        <CardBody>
          {openWorkUnavailable ? (
            <p className="text-meta text-muted">
              Open work could not be loaded. Check your connection and try
              again.
            </p>
          ) : openWork === null ? (
            <p className="text-meta text-subtle">Reading open work…</p>
          ) : openWork.total === 0 ? (
            <p className="text-meta text-muted">
              Nothing is waiting on a person.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* The same words as the document row and the list's preview, so
                  open work reads the same wherever it is counted. */}
              <ul className="flex flex-col gap-2">
                {openWorkParts(openWork).map((part) => (
                  <li key={part.label}>
                    <StatusDot tone={part.tone}>{part.label}</StatusDot>
                  </li>
                ))}
              </ul>
              <Link
                to="/verify"
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'self-start',
                })}
              >
                Review in Verify
              </Link>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function factsOf(matter: MatterRecord): Array<[string, string]> {
  return [
    ['Jurisdiction', matter.primaryJurisdiction],
    ['Domains', matter.legalDomains.join(', ') || 'None recorded'],
    ['Opened', formatDate(matter.createdAt)],
    ['Updated', formatDate(matter.updatedAt)],
  ]
}
