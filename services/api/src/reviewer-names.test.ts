import { describe, expect, it } from 'bun:test'
import type { Pool } from 'pg'

import { reviewerNames } from './reviewer-names'

describe('reviewerNames', () => {
  it('resolves a member name from the organisation without selecting an email', async () => {
    const queries: unknown[][] = []
    const queryable = {
      query: async (...args: unknown[]) => {
        queries.push(args)
        return { rows: [{ id: 'usr_1', name: 'A. Morgan' }] }
      },
    } as unknown as Pool

    const names = await reviewerNames(queryable, 'org_1', ['usr_1'])

    expect(names.get('usr_1')).toBe('A. Morgan')
    const sql = String(queries[0]?.[0])
    expect(sql).toContain('"organisationId" = $1')
    expect(sql).not.toContain('email')
  })

  it('leaves a member who has left the organisation unnamed', async () => {
    const queryable = {
      query: async (sql: string) => ({
        rows: sql.includes('"organisationId" = $1')
          ? []
          : [{ id: 'usr_gone', name: 'Leaked elsewhere' }],
      }),
    } as unknown as Pool

    const names = await reviewerNames(queryable, 'org_1', ['usr_gone'])

    expect(names.get('usr_gone')).toBeUndefined()
  })
})
