import type { PoolClient } from 'pg'

export async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch {
    // The connection is already broken; there is nothing to roll back.
  }
}
