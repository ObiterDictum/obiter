import { useState } from 'react'
import { Table, TBody, TD, TH, THead, TR } from '@obiter/ui'
import { CaretDown, CaretUp } from '@obiter/ui/icons'
import type {
  StaffUsageOrganisation,
  StaffUsageRetention,
  StaffUsageWeek,
} from '@obiter/contracts'
import { formatDate } from '../format'
import {
  nextOrganisationSort,
  retentionGrid,
  retentionPercent,
  sortOrganisations,
  type OrganisationSort,
  type OrganisationSortColumn,
} from './staff-usage-data'

const COUNT_COLUMNS = [
  ['activeUsers', 'Active users'],
  ['newAccounts', 'New accounts'],
  ['documentsOpened', 'Documents opened'],
  ['documentsSaved', 'Documents saved'],
  ['mattersCreated', 'Matters created'],
  ['redactionRuns', 'Redact runs'],
  ['verificationRuns', 'Verify runs'],
  ['agentRuns', 'Agent runs'],
  ['sourcesSaved', 'Sources saved'],
] as const

const NUMERIC_CELL = 'text-end tabular-nums'

export function WeeklyCountsTable({ weeks }: { weeks: StaffUsageWeek[] }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[64rem]">
        <THead>
          <TR>
            <TH>Week</TH>
            {COUNT_COLUMNS.map(([key, label]) => (
              <TH key={key} align="end">
                {label}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {weeks.map((week) => (
            <TR key={week.weekStart}>
              <TD className="whitespace-nowrap">
                {formatDate(week.weekStart)}
              </TD>
              {COUNT_COLUMNS.map(([key]) => (
                <TD key={key} className={NUMERIC_CELL}>
                  {week[key]}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

function SortHeader({
  column,
  label,
  numeric,
  sort,
  onSort,
}: {
  column: OrganisationSortColumn
  label: string
  numeric: boolean
  sort: OrganisationSort
  onSort: (column: OrganisationSortColumn) => void
}) {
  const active = sort.column === column
  return (
    <TH
      aria-sort={
        active
          ? sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      align={numeric ? 'end' : 'start'}
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
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[72rem]">
        <THead>
          <TR>
            <SortHeader
              column="name"
              label="Organisation"
              numeric={false}
              sort={sort}
              onSort={changeSort}
            />
            <SortHeader
              column="memberCount"
              label="Members"
              numeric
              sort={sort}
              onSort={changeSort}
            />
            {COUNT_COLUMNS.map(([key, label]) => (
              <SortHeader
                key={key}
                column={key}
                label={label}
                numeric
                sort={sort}
                onSort={changeSort}
              />
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((org) => (
            <TR key={org.organisationId}>
              <TD className="whitespace-nowrap">{org.name}</TD>
              <TD className={NUMERIC_CELL}>{org.memberCount}</TD>
              {COUNT_COLUMNS.map(([key]) => (
                <TD key={key} className={NUMERIC_CELL}>
                  {org[key]}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
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
    <div className="overflow-x-auto">
      <Table className="min-w-[48rem]">
        <THead>
          <TR>
            <TH>Signup week</TH>
            <TH align="end">Signed up</TH>
            {Array.from({ length: grid.weekCount }, (_, index) => (
              <TH key={index} align="end">
                Week {index}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {grid.cohorts.map((cohort) => (
            <TR key={cohort.cohortWeek}>
              <TD className="whitespace-nowrap">
                {formatDate(cohort.cohortWeek)}
              </TD>
              <TD className={NUMERIC_CELL}>{cohort.cohortSize}</TD>
              {cohort.cells.map((active, index) => (
                <TD key={index} className={NUMERIC_CELL}>
                  {active === null
                    ? null
                    : `${retentionPercent(active, cohort.cohortSize)}% · ${active}`}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
