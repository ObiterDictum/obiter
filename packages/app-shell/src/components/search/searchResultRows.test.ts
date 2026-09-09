import { describe, expect, it } from 'vitest'
import { searchResultRows } from './searchResultRows'
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
})
