import type {
  StaffUsageOrganisation,
  StaffUsageRetention,
} from '@obiter/contracts'

export type OrganisationSortColumn =
  | 'name'
  | 'memberCount'
  | 'activeUsers'
  | 'newAccounts'
  | 'documentsOpened'
  | 'documentsSaved'
  | 'mattersCreated'
  | 'redactionRuns'
  | 'verificationRuns'
  | 'agentRuns'
  | 'sourcesSaved'

export interface OrganisationSort {
  column: OrganisationSortColumn
  direction: 'asc' | 'desc'
}

export function sortOrganisations(
  rows: StaffUsageOrganisation[],
  sort: OrganisationSort,
): StaffUsageOrganisation[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let order: number
    if (sort.column === 'name') {
      order = a.name.localeCompare(b.name)
    } else {
      order = a[sort.column] - b[sort.column]
    }
    if (order !== 0) return order * sign
    return a.name.localeCompare(b.name)
  })
}

export function nextOrganisationSort(
  current: OrganisationSort,
  column: OrganisationSortColumn,
): OrganisationSort {
  if (current.column !== column) {
    return { column, direction: column === 'name' ? 'asc' : 'desc' }
  }
  return {
    column,
    direction: current.direction === 'asc' ? 'desc' : 'asc',
  }
}

export interface RetentionCohort {
  cohortWeek: string
  cohortSize: number
  cells: (number | null)[]
}

export interface RetentionGrid {
  cohorts: RetentionCohort[]
  weekCount: number
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function weekStartMs(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`)
}

export function retentionGrid(retention: StaffUsageRetention[]): RetentionGrid {
  const cohorts = new Map<
    string,
    { cohortSize: number; cells: Map<number, number> }
  >()
  let weekCount = 0
  for (const row of retention) {
    const cohortStart = weekStartMs(row.cohortWeek)
    const weekOffset = Math.round(
      (weekStartMs(row.weekStart) - cohortStart) / WEEK_MS,
    )
    if (weekOffset < 0) continue
    let cohort = cohorts.get(row.cohortWeek)
    if (!cohort) {
      cohort = { cohortSize: row.cohortSize, cells: new Map() }
      cohorts.set(row.cohortWeek, cohort)
    }
    cohort.cells.set(weekOffset, row.activeUsers)
    weekCount = Math.max(weekCount, weekOffset + 1)
  }
  const ordered = [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b))
  return {
    cohorts: ordered.map(([cohortWeek, cohort]) => ({
      cohortWeek,
      cohortSize: cohort.cohortSize,
      cells: Array.from(
        { length: weekCount },
        (_, offset) => cohort.cells.get(offset) ?? null,
      ),
    })),
    weekCount,
  }
}

export function retentionPercent(
  activeUsers: number,
  cohortSize: number,
): number {
  if (cohortSize <= 0) return 0
  return Math.round((activeUsers / cohortSize) * 100)
}
