import { describe, expect, it } from 'bun:test'
import type { PoolClient } from 'pg'

import { rollbackQuietly } from './database-transaction'

describe('rollbackQuietly', () => {
  it('swallows a rollback failure on a connection that is already broken', async () => {
    const client = {
      query: async () => {
        throw new Error('synthetic broken connection')
      },
    } as unknown as PoolClient

    await expect(rollbackQuietly(client)).resolves.toBeUndefined()
  })

  it('rolls the transaction back', async () => {
    const statements: string[] = []
    const client = {
      query: async (statement: string) => {
        statements.push(statement)
      },
    } as unknown as PoolClient

    await rollbackQuietly(client)

    expect(statements).toEqual(['rollback'])
  })
})
