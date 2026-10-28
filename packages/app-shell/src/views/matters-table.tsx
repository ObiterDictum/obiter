import { Link } from '@tanstack/react-router'
import { CaretRight } from '@phosphor-icons/react'
import {
  Skeleton,
  StatusDot,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  cn,
} from '@obiter/ui'
import { formatDateTime } from '../format'
import type { MatterRecord } from '../matters'
import { matterTileLabel } from '../sidebar-rows'
import type { MatterRow } from './matters-rows'

/**
 * The matter's initials tile: the client reference's letters where there is a
 * reference, else the name's. Decorative, hidden from assistive technology —
 * the name always sits beside it.
 */
export function MatterTile({ matter }: { matter: MatterRecord }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-sm bg-fill text-caption text-muted"
    >
      {matterTileLabel(matter)}
    </span>
  )
}

/**
 * The matters table. Every value comes from the API or from the runs the shell
 * already reads: the matter's own fields, its documents, and the attention items
 * Home ranks. The title is the row's control, so the preview is reachable from
 * the keyboard as well as the mouse.
 */
export function MattersTable({
  rows,
  selectedId,
  onSelect,
  openWorkUnavailable,
}: {
  rows: MatterRow[]
  selectedId: string | null
  onSelect: (matterId: string) => void
  /** The runs behind open work could not be read: say so rather than guess. */
  openWorkUnavailable: boolean
}) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="w-[45%] pl-4">Matter</TH>
          <TH className="w-[11%] px-4 text-right">Documents</TH>
          <TH className="w-[26%] px-4">Open work</TH>
          <TH className="w-[18%] px-4 text-right">Last activity</TH>
          <TH className="pr-4">
            <span className="sr-only">Open</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const matter = row.matter
          const selected = matter.id === selectedId
          return (
            <TR
              key={matter.id}
              className={cn('cursor-pointer', selected && 'bg-brand-soft')}
              onClick={() => onSelect(matter.id)}
            >
              <TD className="pr-4 pl-4">
                <div className="flex min-w-0 items-center gap-3">
                  <MatterTile matter={matter} />
                  <div className="min-w-0">
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => onSelect(matter.id)}
                      className="block max-w-full text-left text-item text-ink hover:text-brand"
                    >
                      {matter.name}
                      <span className="sr-only"> — preview</span>
                    </button>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-meta text-subtle">
                      {matter.clientReference ? (
                        <span className="font-mono">
                          {matter.clientReference}
                        </span>
                      ) : null}
                      <span>
                        {matter.legalDomains[0] ?? matter.primaryJurisdiction}
                      </span>
                    </span>
                  </div>
                </div>
              </TD>
              <TD className="px-4 text-right text-meta tabular-nums">
                {row.documentCount === null ? (
                  <>
                    <Skeleton className="ml-auto h-3 w-4" />
                    <span className="sr-only">Counting documents…</span>
                  </>
                ) : (
                  row.documentCount
                )}
              </TD>
              <TD className="px-4">
                <OpenWorkCell row={row} unavailable={openWorkUnavailable} />
              </TD>
              <TD className="px-4 text-right text-meta whitespace-nowrap text-subtle">
                {formatDateTime(row.lastActivity)}
              </TD>
              <TD className="pr-4 text-right">
                <Link
                  to="/matters/$matterId"
                  params={{ matterId: matter.id }}
                  aria-label={`Open ${matter.name}`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink"
                >
                  <CaretRight size={16} aria-hidden />
                </Link>
              </TD>
            </TR>
          )
        })}
      </TBody>
    </Table>
  )
}

function OpenWorkCell({
  row,
  unavailable,
}: {
  row: MatterRow
  unavailable: boolean
}) {
  if (unavailable) {
    return <span className="text-meta text-subtle">Unavailable</span>
  }
  if (row.openWork === null) {
    return (
      <>
        <Skeleton className="h-3 w-24" />
        <span className="sr-only">Reading open work…</span>
      </>
    )
  }
  if (row.openWork.total === 0) {
    return <span className="text-meta text-subtle">No open work</span>
  }
  const parts: Array<{ label: string; tone: 'danger' | 'warning' | 'info' }> =
    []
  if (row.openWork.flaggedFindings > 0) {
    parts.push({
      label: `${row.openWork.flaggedFindings} flagged`,
      tone: 'danger',
    })
  }
  if (row.openWork.reviewFindings > 0) {
    parts.push({
      label: `${row.openWork.reviewFindings} need review`,
      tone: 'warning',
    })
  }
  if (row.openWork.redactionDecisions > 0) {
    parts.push({
      label: `${row.openWork.redactionDecisions} redaction ${row.openWork.redactionDecisions === 1 ? 'decision' : 'decisions'}`,
      tone: 'info',
    })
  }
  if (row.openWork.failed > 0) {
    parts.push({ label: `${row.openWork.failed} failed`, tone: 'danger' })
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      {parts.map((part) => (
        <StatusDot key={part.label} tone={part.tone}>
          {part.label}
        </StatusDot>
      ))}
    </span>
  )
}
