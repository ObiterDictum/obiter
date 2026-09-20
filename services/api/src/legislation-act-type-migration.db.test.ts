import { readFileSync } from 'node:fs'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestPool } from './test-database.test-support'

/**
 * Restoring `legislation_documents_act_type_check` on a database whose
 * `legislation_documents` table predates 0020. 0020 declares the constraint
 * only inside `create table if not exists`, so an existing table never received
 * it, and a fresh-install run of the migration skips the add entirely.
 *
 * The migration therefore runs here against a scratch schema that reproduces
 * the pre-0020 state: the table exists without the constraint, so the add path
 * is exercised. Everything runs in one rolled-back transaction in a throwaway
 * schema, so the real `legislation_documents` table is untouched.
 */

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0025_legislation_act_type_check.sql',
    import.meta.url,
  ),
  'utf8',
)

const scratchSchema = 'act_type_check_scratch'

describe('legislation act-type constraint migration (db)', () => {
  const pool = createTestPool()
  let client: PoolClient

  beforeAll(async () => {
    client = await pool.connect()
    await client.query('begin')
    await client.query(`create schema ${scratchSchema}`)
    await client.query(`set local search_path to ${scratchSchema}`)
    await client.query(
      'create table legislation_documents (identity text primary key, act_type text not null)',
    )
  })

  afterAll(async () => {
    await client.query('rollback')
    client.release()
    await pool.end()
  })

  it('adds and validates the constraint on a pre-existing table', async () => {
    await client.query(migration)

    const constraint = await client.query<{
      definition: string
      validated: boolean
    }>(
      `select pg_get_constraintdef(oid) as definition, convalidated as validated
       from pg_constraint
       where conname = 'legislation_documents_act_type_check'
         and conrelid = 'legislation_documents'::regclass`,
    )
    expect(constraint.rows).toHaveLength(1)
    expect(constraint.rows[0]?.definition).toMatch(/act_type = 'ukpga'/)
    expect(constraint.rows[0]?.validated).toBe(true)

    await expect(
      client.query(
        `insert into legislation_documents values ('ukpga/2020/1', 'ukpga')`,
      ),
    ).resolves.toBeDefined()
  })

  it('rejects a non-ukpga act type after the migration', async () => {
    // Run the migration here too so this test does not depend on the order of
    // the test above: a second run must be a no-op and leave the rule in place.
    await client.query(migration)
    await client.query('savepoint before_invalid_insert')
    await expect(
      client.query(
        `insert into legislation_documents values ('foo/2020/1', 'foo')`,
      ),
    ).rejects.toThrow(/legislation_documents_act_type_check/)
    // Stay in the transaction so the surrounding rollback still runs.
    await client.query('rollback to savepoint before_invalid_insert')
  })
})
