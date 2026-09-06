import { describe, expect, it } from 'vitest'
import { diffParity, runParityCheck } from './check-search-parity'

describe('diffParity', () => {
  it('reports clean when both sides agree', () => {
    expect(diffParity(['a', 'b'], ['a', 'b'])).toEqual({
      missingFromIndex: [],
      extraInIndex: [],
    })
  })

  it('detects a missing and an extra id in opposite directions', () => {
    expect(diffParity(['a', 'b'], ['b', 'c'])).toEqual({
      missingFromIndex: ['a'],
      extraInIndex: ['c'],
    })
  })
})

describe('runParityCheck', () => {
  it('detects deliberate drift seeded on both sides', async () => {
    // Postgres holds a and b; the index holds b and a stale c. The report
    // must name a as missing and c as extra.
    const pool = {
      query: async () => ({
        rows: [{ document_id: 'a' }, { document_id: 'b' }],
      }),
    } as unknown as Parameters<typeof runParityCheck>[0]['pool']

    const report = await runParityCheck({
      pool,
      listIndexIds: async () => ['b', 'c'],
      indexName: 'legal_authorities',
      pageSize: 10,
    })

    expect(report.postgresCount).toBe(2)
    expect(report.indexCount).toBe(2)
    expect(report.missingFromIndex).toEqual(['a'])
    expect(report.extraInIndex).toEqual(['c'])
  })

  it('pages Postgres and scopes the record query to non-withdrawn rows', async () => {
    const seen: string[] = []
    const pool = {
      query: async (text: string) => {
        seen.push(text)
        return { rows: [] }
      },
    } as unknown as Parameters<typeof runParityCheck>[0]['pool']

    const report = await runParityCheck({
      pool,
      listIndexIds: async () => [],
      indexName: 'legal_authorities',
    })

    expect(seen[0]).toContain(`provider_json->>'withdrawn' is null`)
    expect(report.missingFromIndex).toEqual([])
    expect(report.extraInIndex).toEqual([])
  })
})
