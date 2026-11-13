import { useState, type ReactNode } from 'react'
import { Table, TBody, TD, TH, THead, TR } from '@obiter/ui'
import { CaretDown, CaretUp } from '@obiter/ui/icons'
import type {
  StaffUsageOrganisation,
  StaffUsageRetention,
  StaffUsageWeek,
} from '@obiter/contracts'
import { formatDate } from '../format'
import {
  duplicatedOrganisationNames,
  nextOrganisationSort,
  retentionGrid,
  retentionPercent,
  sortOrganisations,
  type OrganisationSort,
  type OrganisationSortColumn,
} from './staff-usage-data'

const COUNT_COLUMNS = [
  ['activeUsers', 'Active', 'Active users'],
  ['newAccounts', 'New', 'New accounts'],
  ['documentsOpened', 'Docs opened', 'Documents opened'],
  ['documentsSaved', 'Docs saved', 'Documents saved'],
  ['mattersCreated', 'Matters', 'Matters created'],
  ['redactionRuns', 'Redact', 'Redaction runs'],
  ['verificationRuns', 'Verify', 'Verification runs'],
  ['agentRuns', 'Agent', 'Agent runs'],
  ['sourcesSaved', 'Sources', 'Sources saved'],
] as const

const DENSE_CELL = 'px-2 py-1.5 text-end tabular-nums'
const FIRST_HEAD = 'sticky left-0 z-10 whitespace-nowrap bg-raised px-3 pb-2'
const FIRST_CELL =
  'sticky left-0 z-10 whitespace-nowrap bg-raised px-3 py-1.5 group-hover:bg-hover'

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

export function WeeklyCountsTable({ weeks }: { weeks: StaffUsageWeek[] }) {
  return (
    <ScrollRegion label="Weekly feature counts">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className={FIRST_HEAD}>Week</TH>
            {COUNT_COLUMNS.map(([key, label, title]) => (
              <TH
                key={key}
                align="end"
                title={title}
                className="whitespace-nowrap px-2 pb-2"
              >
                {label}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {weeks.map((week) => (
            <TR key={week.weekStart} className="group">
              <TD className={FIRST_CELL}>{formatDate(week.weekStart)}</TD>
              {COUNT_COLUMNS.map(([key]) => (
                <TD key={key} className={DENSE_CELL}>
                  {week[key]}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </ScrollRegion>
  )
}

function SortHeader({
  column,
  label,
  title,
  numeric,
  sort,
  onSort,
}: {
  column: OrganisationSortColumn
  label: string
  title: string
  numeric: boolean
  sort: OrganisationSort
  onSort: (column: OrganisationSortColumn) => void
}) {
  const active = sort.column === column
  return (
    <TH
      title={title}
      aria-sort={
        active
          ? sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      align={numeric ? 'end' : 'start'}
      className={numeric ? 'whitespace-nowrap px-2 pb-2' : FIRST_HEAD}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-caption text-subtle hover:text-ink"
      >
        {label}
        {active ? (
          sort.direction === 'asc' ? (
            <CaretUp size={10} aria-hidden />
          ) : (
            <CaretDown size={10} aria-hidden />
          )
        ) : null}
      </button>
    </TH>
  )
}

export function OrganisationsTable({
  organisations,
}: {
  organisations: StaffUsageOrganisation[]
}) {
  const [sort, setSort] = useState<OrganisationSort>({
    column: 'activeUsers',
    direction: 'desc',
  })
  const changeSort = (column: OrganisationSortColumn) =>
    setSort((current) => nextOrganisationSort(current, column))
  const rows = sortOrganisations(organisations, sort)
  const duplicates = duplicatedOrganisationNames(organisations)
  return (
    <ScrollRegion label="Usage by organisation">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <SortHeader
              column="name"
              label="Organisation"
              title="Organisation"
              numeric={false}
              sort={sort}
              onSort={changeSort}
            />
            <SortHeader
              column="memberCount"
              label="Members"
              title="Members"
              numeric
              sort={sort}
              onSort={changeSort}
            />
            {COUNT_COLUMNS.map(([key, label, title]) => (
              <SortHeader
                key={key}
                column={key}
                label={label}
                title={title}
                numeric
                sort={sort}
                onSort={changeSort}
              />
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((org) => (
            <TR key={org.organisationId} className="group">
              <TD className={FIRST_CELL}>
                {org.name}
                {duplicates.has(org.name) ? (
                  <span className="text-caption text-subtle">
                    {' · '}
                    {org.organisationId.slice(0, 6)}
                  </span>
                ) : null}
              </TD>
              <TD className={DENSE_CELL}>{org.memberCount}</TD>
              {COUNT_COLUMNS.map(([key]) => (
                <TD key={key} className={DENSE_CELL}>
                  {org[key]}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </ScrollRegion>
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
  return (
    <TD
      className={`${DENSE_CELL} whitespace-nowrap`}
      aria-label={`Week ${week}: ${percent} percent, ${active} of ${cohortSize} active`}
      style={{
        backgroundColor: `color-mix(in srgb, var(--obiter-brand) ${Math.round(percent * 0.4)}%, var(--obiter-surface-raised))`,
      }}
    >
      <span className="flex flex-col items-end">
        <span className="text-meta">{percent}%</span>
        <span className="text-caption text-subtle">{active}</span>
      </span>
    </TD>
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
  )
}
