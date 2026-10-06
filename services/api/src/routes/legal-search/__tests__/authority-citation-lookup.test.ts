import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../../scripts/test/vitest-compat'
import type { Pool, QueryResultRow } from 'pg'
import {
  findStoredAuthorityIdsByNeutralCitation,
  findStoredAuthorityIdsByNeutralCitations,
} from '../source-store'

/**
 * The shape of the case-law candidate query, pinned structurally rather than
 * by wall-clock timing. The regression this guards: the lookup used to
 * transfer every stored citation row to Node on each call. The query must push
 * the citation year into SQL, return only the citation projection, and order
 * deterministically, so a per-document V3 caller does not pay a full-table
 * transfer per citation.
 */

interface QueryCall {
  text: string
  values: unknown[] | undefined
}

function fakePool(rows: QueryResultRow[]) {
  const calls: QueryCall[] = []
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      return { rows }
    }),
  }
  return { pool: pool as unknown as Pick<Pool, 'query'>, calls }
}

describe('case law candidate lookup', () => {
  it('pushes the citation year into SQL and returns only the projection', async () => {
    const { pool, calls } = fakePool([
      { documentId: 'uksc-2024-22', neutralCitation: '[2024] UKSC 22' },
      { documentId: 'uksc-2024-23', neutralCitation: '[2024] UKSC 23' },
      { documentId: 'uksc-2023-1', neutralCitation: '[2023] UKSC 1' },
    ])

    const ids = await findStoredAuthorityIdsByNeutralCitation(
      pool,
      '[2024] UKSC 22',
    )

    expect(ids).toEqual(['uksc-2024-22'])
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.text).toContain('like any')
    expect(call?.text).toContain('order by document_id')
    expect(call?.text).not.toContain('document_json')
    expect(call?.values).toEqual([['%2024%']])
  })

  it('covers several citations with one query when they share a year', async () => {
    const { pool, calls } = fakePool([
      { documentId: 'uksc-2024-22', neutralCitation: '[2024] UKSC 22' },
      { documentId: 'uksc-2024-23', neutralCitation: '[2024] UKSC 23' },
    ])

    const matches = await findStoredAuthorityIdsByNeutralCitations(pool, [
      '[2024] UKSC 22',
      '[2024] UKSC 23',
      '[2024] UKSC 22',
    ])

    expect(calls).toHaveLength(1)
    expect(matches.get('[2024] uksc 22')).toEqual(['uksc-2024-22'])
    expect(matches.get('[2024] uksc 23')).toEqual(['uksc-2024-23'])
  })

  it('falls back to the full projection only for a citation with no year', async () => {
    const { pool, calls } = fakePool([
      { documentId: 'uksc-2024-22', neutralCitation: '[2024] UKSC 22' },
    ])

    const ids = await findStoredAuthorityIdsByNeutralCitation(pool, 'UKSC 22')

    expect(ids).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.text).not.toContain('like any')
  })

  it('keeps the year query when a batch mixes dated and undated citations', async () => {
    const { pool, calls } = fakePool([
      { documentId: 'uksc-2024-22', neutralCitation: '[2024] UKSC 22' },
    ])

    await findStoredAuthorityIdsByNeutralCitations(pool, [
      '[2024] UKSC 22',
      'UKSC 22',
    ])

    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.text.includes('like any'))).toBe(true)
  })

  it('sorts grouped ids regardless of the order the rows arrive in', async () => {
    const { pool } = fakePool([
      { documentId: 'z-duplicate', neutralCitation: '[2024] UKSC 22' },
      { documentId: 'a-duplicate', neutralCitation: '[2024] UKSC 22' },
    ])

    const matches = await findStoredAuthorityIdsByNeutralCitations(pool, [
      '[2024] UKSC 22',
    ])

    expect(matches.get('[2024] uksc 22')).toEqual([
      'a-duplicate',
      'z-duplicate',
    ])
  })

  it('returns no matches for a blank citation without querying', async () => {
    const { pool, calls } = fakePool([])

    const ids = await findStoredAuthorityIdsByNeutralCitation(pool, '   ')

    expect(ids).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
