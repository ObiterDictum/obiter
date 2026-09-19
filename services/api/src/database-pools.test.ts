import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabasePools } from './database-pools'
import { createTestApiEnv } from './test-api-env'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createDatabasePools', () => {
  it('uses one pool for both databases in the compatibility configuration', async () => {
    const env = createTestApiEnv()

    const pools = createDatabasePools(env)

    expect(pools.corpus.pool).toBe(pools.application)
    expect(pools.corpus.readOnly).toBe(false)

    await pools.close()
  })

  it('treats a differently written URL for the same database as colocated', async () => {
    // A password or a parameter can differ while the database does not.
    // Reading that as a separate corpus would silently make the corpus
    // read-only, which is a behaviour change nobody asked for.
    const env = createTestApiEnv({
      databaseUrl: 'postgres://obiter@localhost:5432/obiter',
      corpusDatabaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
    })

    const pools = createDatabasePools(env)

    expect(pools.corpus.pool).toBe(pools.application)
    expect(pools.corpus.readOnly).toBe(false)

    await pools.close()
  })

  it('keeps a separate corpus database and marks it read-only', async () => {
    const env = createTestApiEnv({
      corpusDatabaseUrl: 'postgres://obiter@localhost:5432/obiter_corpus',
    })

    const pools = createDatabasePools(env)

    expect(pools.corpus.pool).not.toBe(pools.application)
    expect(pools.corpus.readOnly).toBe(true)

    await pools.close()
  })

  it('closes the single pool once when the databases are colocated', async () => {
    const end = vi.spyOn(Pool.prototype, 'end')
    const pools = createDatabasePools(createTestApiEnv())

    await pools.close()
    await pools.close()

    // A second end() on a pool already ended is how a shutdown path closes a
    // pool another owner still expects to use.
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes each distinct pool exactly once', async () => {
    const end = vi.spyOn(Pool.prototype, 'end')
    const pools = createDatabasePools(
      createTestApiEnv({
        corpusDatabaseUrl: 'postgres://obiter@localhost:5432/obiter_corpus',
      }),
    )

    await pools.close()
    await pools.close()

    expect(end).toHaveBeenCalledTimes(2)
  })
})
