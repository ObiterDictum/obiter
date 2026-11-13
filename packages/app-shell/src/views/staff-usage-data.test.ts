import { describe, expect, it } from 'bun:test'
import type {
  StaffUsageOrganisation,
  StaffUsageRetention,
} from '@obiter/contracts'
import {
  duplicatedOrganisationNames,
  nextOrganisationSort,
  retentionGrid,
  retentionPercent,
  sortOrganisations,
} from './staff-usage-data'

function organisation(
  overrides: Partial<StaffUsageOrganisation> & { name: string },
): StaffUsageOrganisation {
  return {
    organisationId: `org_${overrides.name}`,
    memberCount: 0,
    activeUsers: 0,
    newAccounts: 0,
    documentsOpened: 0,
    documentsSaved: 0,
    mattersCreated: 0,
    redactionRuns: 0,
    verificationRuns: 0,
    agentRuns: 0,
    sourcesSaved: 0,
    ...overrides,
  }
}

describe('sortOrganisations', () => {
  const rows = [
    organisation({ name: 'Beta', activeUsers: 4, memberCount: 9 }),
    organisation({ name: 'Alpha', activeUsers: 9, memberCount: 2 }),
    organisation({ name: 'Gamma', activeUsers: 4, memberCount: 5 }),
  ]

  it('orders rows by the chosen column in the chosen direction', () => {
    expect(
      sortOrganisations(rows, { column: 'activeUsers', direction: 'desc' }).map(
        (row) => row.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(
      sortOrganisations(rows, { column: 'activeUsers', direction: 'asc' }).map(
        (row) => row.name,
      ),
    ).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('breaks count ties by organisation name', () => {
    expect(
      sortOrganisations(rows, { column: 'activeUsers', direction: 'desc' })
        .slice(1)
        .map((row) => row.name),
    ).toEqual(['Beta', 'Gamma'])
  })

  it('sorts the name column alphabetically', () => {
    expect(
      sortOrganisations(rows, { column: 'name', direction: 'asc' }).map(
        (row) => row.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})

describe('duplicatedOrganisationNames', () => {
  it('flags only names shared by two or more organisations', () => {
    const names = duplicatedOrganisationNames([
      organisation({
        name: 'Personal workspace',
        organisationId: 'org_aaaa111',
      }),
      organisation({
        name: 'Personal workspace',
        organisationId: 'org_bbbb222',
      }),
      organisation({ name: 'Counsel', organisationId: 'org_cccc333' }),
    ])
    expect(names.has('Personal workspace')).toBe(true)
    expect(names.has('Counsel')).toBe(false)
    expect(names.size).toBe(1)
  })
})

describe('nextOrganisationSort', () => {
  it('starts a numeric column descending and the name column ascending', () => {
    expect(
      nextOrganisationSort(
        { column: 'activeUsers', direction: 'desc' },
        'memberCount',
      ),
    ).toEqual({ column: 'memberCount', direction: 'desc' })
    expect(
      nextOrganisationSort(
        { column: 'activeUsers', direction: 'desc' },
        'name',
      ),
    ).toEqual({ column: 'name', direction: 'asc' })
  })

  it('flips direction when the same column is chosen again', () => {
    expect(
      nextOrganisationSort(
        { column: 'activeUsers', direction: 'desc' },
        'activeUsers',
      ),
    ).toEqual({ column: 'activeUsers', direction: 'asc' })
    expect(
      nextOrganisationSort({ column: 'name', direction: 'asc' }, 'name'),
    ).toEqual({ column: 'name', direction: 'desc' })
  })
})

function retentionRow(
  cohortWeek: string,
  weekStart: string,
  cohortSize: number,
  activeUsers: number,
): StaffUsageRetention {
  return { cohortWeek, weekStart, cohortSize, activeUsers }
}

describe('retentionGrid', () => {
  it('groups rows into cohorts and leaves future weeks blank', () => {
    const grid = retentionGrid([
      retentionRow('2026-01-05', '2026-01-05', 4, 4),
      retentionRow('2026-01-05', '2026-01-12', 4, 2),
      retentionRow('2026-01-12', '2026-01-12', 3, 3),
    ])
    expect(grid.weekCount).toBe(2)
    expect(grid.cohorts).toEqual([
      {
        cohortWeek: '2026-01-05',
        cohortSize: 4,
        cells: [4, 2],
      },
      {
        cohortWeek: '2026-01-12',
        cohortSize: 3,
        cells: [3, null],
      },
    ])
  })

  it('returns no cohorts when the API sends no retention rows', () => {
    expect(retentionGrid([])).toEqual({ cohorts: [], weekCount: 0 })
  })
})

describe('retentionPercent', () => {
  it('shows the share of the cohort still active', () => {
    expect(retentionPercent(2, 4)).toBe(50)
    expect(retentionPercent(3, 3)).toBe(100)
  })

  it('avoids dividing by an empty cohort', () => {
    expect(retentionPercent(0, 0)).toBe(0)
  })
})
