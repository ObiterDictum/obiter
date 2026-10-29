import { describe, expect, it } from 'bun:test'
import type { PoolClient } from 'pg'

import { lockMatterForEdit } from './matter-lock'

describe('lockMatterForEdit', () => {
  it('throws rather than denying when the lock query fails', async () => {
    const client = {
      query: async () => {
        throw new Error('synthetic lock failure')
      },
    } as unknown as PoolClient

    await expect(
      lockMatterForEdit(client, {
        organisationId: 'org_1',
        matterId: 'mtr_1',
        userId: 'usr_1',
      }),
    ).rejects.toThrow('synthetic lock failure')
  })

  it('takes the row lock without an access predicate and re-reads access in a fresh statement', async () => {
    const statements: string[] = []
    const client = {
      query: async (statement: string) => {
        statements.push(statement)
        if (statements.length === 1) return { rows: [{ id: 'mtr_1' }] }
        if (statements.length === 2) return { rows: [{ id: 'mtr_1' }] }
        return { rows: [{ id: 'usr_1' }] }
      },
    } as unknown as PoolClient

    await expect(
      lockMatterForEdit(client, {
        organisationId: 'org_1',
        matterId: 'mtr_1',
        userId: 'usr_1',
      }),
    ).resolves.toBe(true)

    expect(statements[0]).toContain('for update')
    expect(statements[0]).not.toContain('matter_shares')
    expect(statements[1]).toContain('matter_shares')
    expect(statements).toHaveLength(3)
  })
})
