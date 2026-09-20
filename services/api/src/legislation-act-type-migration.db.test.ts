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
 * Every scenario runs in a throwaway schema inside one rolled-back transaction,
 * so the real `legislation_documents` table is untouched. The migration's
 * unqualified relation names resolve through `search_path`, which each scenario
 * points at its scratch schema, exactly as the runner would.
 */

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0025_legislation_act_type_check.sql',
    import.meta.url,
  ),
  'utf8',
)

const canonicalValidated = "CHECK ((act_type = 'ukpga'::text))"
const canonicalNotValid = "CHECK ((act_type = 'ukpga'::text)) NOT VALID"
const constraintName = 'legislation_documents_act_type_check'

interface ConstraintRow {
  contype: string
  validated: boolean
  definition: string
}

describe('legislation act-type constraint migration (db)', () => {
  const pool = createTestPool()
  let client: PoolClient
  let schemaCount = 0

  beforeAll(async () => {
    client = await pool.connect()
    await client.query('begin')
  })

  afterAll(async () => {
    await client.query('rollback')
    client.release()
    await pool.end()
  })

  /** A fresh schema holding the pre-0020 table, made the search_path target. */
  async function scratchSchema(): Promise<string> {
    const schema = `act_type_migration_${schemaCount++}`
    await client.query(`create schema ${schema}`)
    await client.query(`set local search_path to ${schema}`)
    await client.query(
      'create table legislation_documents (identity text primary key, act_type text not null)',
    )
    return schema
  }

  /**
   * Run the migration inside a savepoint so a hard failure leaves the
   * transaction usable for assertions and the next scenario, and returns the
   * failure message (null when it succeeded).
   */
  async function runMigration(): Promise<string | null> {
    await client.query('savepoint before_migration')
    try {
      await client.query(migration)
      await client.query('release savepoint before_migration')
      return null
    } catch (error) {
      await client.query('rollback to savepoint before_migration')
      return error instanceof Error ? error.message : String(error)
    }
  }

  async function constraint(
    schema: string,
    table = 'legislation_documents',
  ): Promise<ConstraintRow | null> {
    const { rows } = await client.query<ConstraintRow>(
      `select contype, convalidated as validated, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`${schema}.${table}`, constraintName],
    )
    return rows[0] ?? null
  }

  it('adds and validates the constraint on a pre-existing table', async () => {
    const schema = await scratchSchema()

    expect(await runMigration()).toBeNull()
    expect(await constraint(schema)).toEqual({
      contype: 'c',
      validated: true,
      definition: canonicalValidated,
    })

    await expect(
      client.query(
        `insert into legislation_documents values ('ukpga/2020/1', 'ukpga')`,
      ),
    ).resolves.toBeDefined()
  })

  it('rejects a non-ukpga act type after the migration', async () => {
    await scratchSchema()
    expect(await runMigration()).toBeNull()

    await client.query('savepoint before_invalid_insert')
    await expect(
      client.query(
        `insert into legislation_documents values ('foo/2020/1', 'foo')`,
      ),
    ).rejects.toThrow(new RegExp(constraintName))
    await client.query('rollback to savepoint before_invalid_insert')
  })

  it('validates a correct but unvalidated constraint without replacing it', async () => {
    const schema = await scratchSchema()
    await client.query(
      `alter table legislation_documents add constraint ${constraintName}
       check (act_type = 'ukpga') not valid`,
    )
    expect(await constraint(schema)).toEqual({
      contype: 'c',
      validated: false,
      definition: canonicalNotValid,
    })

    expect(await runMigration()).toBeNull()
    expect(await constraint(schema)).toEqual({
      contype: 'c',
      validated: true,
      definition: canonicalValidated,
    })
  })

  it('succeeds idempotently when the correct validated constraint exists', async () => {
    const schema = await scratchSchema()
    await client.query(
      `alter table legislation_documents add constraint ${constraintName}
       check (act_type = 'ukpga')`,
    )

    expect(await runMigration()).toBeNull()
    // A second run must not add, drop or revalidate anything: the runner skips
    // a recorded file, and the guard must still be a no-op if it is re-run.
    expect(await runMigration()).toBeNull()

    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`${schema}.legislation_documents`, constraintName],
    )
    expect(rows[0]?.n).toBe(1)
    expect(await constraint(schema)).toEqual({
      contype: 'c',
      validated: true,
      definition: canonicalValidated,
    })
  })

  it('refuses a same-named constraint with a different expression', async () => {
    const schema = await scratchSchema()
    await client.query(
      `alter table legislation_documents add constraint ${constraintName}
       check (act_type <> 'never')`,
    )

    const error = await runMigration()
    expect(error).toContain('unexpected definition')
    // Loud failure, not a silent drop-and-replace of an unexpected object.
    expect(await constraint(schema)).toEqual({
      contype: 'c',
      validated: true,
      definition: "CHECK ((act_type <> 'never'::text))",
    })
  })

  it('refuses a same-named non-CHECK constraint', async () => {
    const schema = await scratchSchema()
    await client.query(
      `alter table legislation_documents add constraint ${constraintName}
       unique (act_type)`,
    )

    expect(await runMigration()).toContain('unexpected definition')
    expect((await constraint(schema))?.contype).toBe('u')
  })

  it('ignores a same-named constraint on another table', async () => {
    const schema = await scratchSchema()
    await client.query(
      `create table other_legislation (
        act_type text not null,
        constraint ${constraintName} check (act_type <> 'never')
      )`,
    )

    expect(await runMigration()).toBeNull()
    expect(await constraint(schema)).toMatchObject({
      definition: canonicalValidated,
    })
    expect(await constraint(schema, 'other_legislation')).toMatchObject({
      definition: "CHECK ((act_type <> 'never'::text))",
    })
  })

  it('ignores a same-named constraint in another schema', async () => {
    const otherSchema = `act_type_other_${schemaCount++}`
    await client.query(`create schema ${otherSchema}`)
    await client.query(
      `create table ${otherSchema}.legislation_documents (
        identity text primary key,
        act_type text not null
      )`,
    )
    await client.query(
      `alter table ${otherSchema}.legislation_documents
       add constraint ${constraintName} check (act_type <> 'never')`,
    )

    const schema = await scratchSchema()
    expect(await runMigration()).toBeNull()
    expect(await constraint(schema)).toMatchObject({
      definition: canonicalValidated,
    })
    expect(await constraint(otherSchema)).toMatchObject({
      definition: "CHECK ((act_type <> 'never'::text))",
    })
  })

  it('fails and records nothing when a pre-existing row violates the rule', async () => {
    const schema = await scratchSchema()
    await client.query(
      `insert into legislation_documents values ('bad/2020/1', 'foo')`,
    )

    expect(await runMigration()).toContain('is violated by some row')
    // The add and the validation rolled back together, so nothing is left
    // half-applied and the migration is not recorded as done.
    expect(await constraint(schema)).toBeNull()
  })

  it('matches the 0020 fresh-install definition exactly', async () => {
    const freshSchema = `act_type_fresh_${schemaCount++}`
    await client.query(`create schema ${freshSchema}`)
    await client.query(`set local search_path to ${freshSchema}`)
    await client.query(
      `create table legislation_documents (
        identity text primary key,
        act_type text not null,
        constraint ${constraintName} check (act_type = 'ukpga')
      )`,
    )
    const fresh = await constraint(freshSchema)

    const schema = await scratchSchema()
    expect(await runMigration()).toBeNull()
    const migrated = await constraint(schema)

    expect(migrated).toEqual(fresh)
    expect(migrated?.definition).toBe(canonicalValidated)
  })
})
