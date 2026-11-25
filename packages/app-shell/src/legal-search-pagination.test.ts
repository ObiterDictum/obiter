import { expect, it } from 'bun:test'
import { mergeLegalSearchPage } from './legal-search-pagination'
import type { LegalSearchFetchResponse } from './components/search/searchTypes'

const hit = (id: string) => ({
  id,
  title: `Case ${id}`,
  neutralCitation: null,
  court: 'uksc',
  dateDecided: '2024-01-31',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
})

function response(
  hits: ReturnType<typeof hit>[],
  page: number,
): LegalSearchFetchResponse {
  return {
    hits,
    cached: true,
    indexedCount: 0,
    skippedCount: 0,
    estimatedTotalHits: 3,
    groups: [
      {
        key: 'legislation',
        label: 'Legislation',
        hits: [],
      },
    ],
    pagination: {
      page,
      limit: 1,
      estimatedTotalHits: 3,
      hasMore: page < 3,
    },
  }
}

it('appends new judgment pages once and keeps first-page legislation groups', () => {
  const merged = mergeLegalSearchPage(
    response([hit('one')], 1),
    response([hit('one'), hit('two')], 2),
  )
  expect(merged.hits.map((entry) => entry.id)).toEqual(['one', 'two'])
  expect(merged.groups).toHaveLength(1)
  expect(merged.pagination?.page).toBe(2)
  expect(merged.estimatedTotalHits).toBe(3)
})
