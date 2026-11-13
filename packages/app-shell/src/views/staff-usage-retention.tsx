import { type ReactNode } from 'react'
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@obiter/ui'
import type { StaffUsageRetention } from '@obiter/contracts'
import { formatDate } from '../format'
import {
  retentionGrid,
  retentionPercent,
  retentionStep,
} from './staff-usage-data'

const DENSE_CELL = 'px-2 py-1.5 text-end tabular-nums'
const FIRST_HEAD = 'sticky left-0 z-10 whitespace-nowrap bg-raised px-3 pb-2'
const FIRST_CELL =
  'sticky left-0 z-10 whitespace-nowrap bg-raised px-3 py-1.5 group-hover:bg-hover'

const RETENTION_TINT = [0, 9, 17, 26, 35]
const RETENTION_LEGEND = ['0', '1–25', '26–50', '51–75', '76–100']

function retentionBackground(step: number): string | undefined {
  const mix = RETENTION_TINT[step]
  if (!mix) return undefined
  return `color-mix(in srgb, var(--obiter-status-success) ${mix}%, var(--obiter-surface-raised))`
}

function ScrollRegion({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto"
    >
      {children}
    </div>
  )
}

function RetentionCell({
  active,
  cohortSize,
  week,
}: {
  active: number | null
  cohortSize: number
  week: number
}) {
  if (active === null) {
    return <TD className={DENSE_CELL} />
  }
  const percent = retentionPercent(active, cohortSize)
  const step = retentionStep(percent)
  const description = `Week ${week}: ${percent}% of the cohort still active, ${active} of ${cohortSize}`
  return (
    <TD
      className={`${DENSE_CELL} whitespace-nowrap`}
      aria-label={description}
      style={{ backgroundColor: retentionBackground(step) }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="flex flex-col items-end rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          }
        >
          <span className="text-meta">{percent}%</span>
          <span className="text-caption text-subtle">{active}</span>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </TD>
  )
}

function RetentionLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-subtle">
      <span>Share of the cohort active that week</span>
      {RETENTION_LEGEND.map((label, step) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border border-line bg-raised"
            style={{ backgroundColor: retentionBackground(step) }}
          />
          {label}
        </span>
      ))}
    </div>
  )
}

export function RetentionTable({
  retention,
}: {
  retention: StaffUsageRetention[]
}) {
  const grid = retentionGrid(retention)
  if (grid.cohorts.length === 0) {
    return <p className="text-meta text-muted">No signup cohorts yet.</p>
  }
  return (
    <>
      <ScrollRegion label="Retention by signup week">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className={FIRST_HEAD}>Signup week</TH>
              <TH
                align="end"
                title="Users who signed up that week"
                className="whitespace-nowrap px-2 pb-2"
              >
                Signed up
              </TH>
              {Array.from({ length: grid.weekCount }, (_, index) => (
                <TH
                  key={index}
                  align="end"
                  className="whitespace-nowrap px-2 pb-2"
                >
                  Week {index}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {grid.cohorts.map((cohort) => (
              <TR key={cohort.cohortWeek} className="group">
                <TD className={FIRST_CELL}>{formatDate(cohort.cohortWeek)}</TD>
                <TD className={DENSE_CELL}>{cohort.cohortSize}</TD>
                {cohort.cells.map((active, index) => (
                  <RetentionCell
                    key={index}
                    active={active}
                    cohortSize={cohort.cohortSize}
                    week={index}
                  />
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </ScrollRegion>
      <RetentionLegend />
    </>
  )
}
