import { describe, expect, it } from 'bun:test'
import {
  filterSearchResultRows,
  formatResultSummary,
  searchResultRows,
} from './searchResultRows'
import type {
  LegalSearchFetchResponse,
  LegislationSearchResultHit,
} from './searchTypes'

const judgment = {
  id: 'uksc-2024-3',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  dateDecided: '2024-01-31',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
}

const provision: LegislationSearchResultHit = {
  id: 'ukpga/2010/15/section/13',
  resultGroup: 'legislation',
  legislationStatus: 'current',
  title: 'Equality Act 2010',
  year: 2010,
  provisionLabel: 's. 13',
  labelPath: 'section/13',
  documentIdentity: 'ukpga/2010/15',
  extent: 'E+W+S',
  officialUrl: 'https://www.legislation.gov.uk/ukpga/2010/15/section/13',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
}

function response(
  overrides: Partial<LegalSearchFetchResponse> = {},
): LegalSearchFetchResponse {
  return {
    hits: [judgment],
    groups: [{ key: 'legislation', label: 'Legislation', hits: [provision] }],
    cached: true,
    indexedCount: 0,
    skippedCount: 0,
    ...overrides,
  }
}

describe('searchResultRows', () => {
  it('puts legislation first only when the API says the query is statute-shaped', () => {
    const led = searchResultRows(response({ primaryGroup: 'legislation' }))
    expect(led.map((row) => row.kind)).toEqual(['legislation', 'judgment'])
    const ordinary = searchResultRows(response())
    expect(ordinary.map((row) => row.kind)).toEqual(['judgment', 'legislation'])
  })

  it('filters only the served answer by the type facet', () => {
    const rows = searchResultRows(response())
    expect(
      filterSearchResultRows(rows, 'judgments').map((row) => row.kind),
    ).toEqual(['judgment'])
    expect(
      filterSearchResultRows(rows, 'legislation').map((row) => row.kind),
    ).toEqual(['legislation'])
    expect(filterSearchResultRows(rows, 'all')).toHaveLength(2)
  })

  it('counts both federated groups and names the source', () => {
    expect(formatResultSummary(response())).toBe(
      '1 judgment · 1 provision from stored legal sources',
    )
  })

  it('names a court browse from the API data', () => {
    expect(
      formatResultSummary(response(), { courtLabel: 'UK Supreme Court' }),
    ).toBe('1 recent case for UK Supreme Court from stored legal sources')
  })
})
