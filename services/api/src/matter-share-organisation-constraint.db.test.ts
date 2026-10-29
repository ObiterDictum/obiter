import { readFileSync } from 'node:fs'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createTestPool } from './test-database.test-support'

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0027_matter_share_grantee_organisation.sql',
    import.meta.url,
  ),
  'utf8',
)

const compositeConstraint = 'matter_shares_grantee_organisation_fk'
const legacyConstraint = 'matter_shares_grantee_fk'

function share(values: string) {
  return `insert into matter_shares
    (id, organisation_id, matter_id, grantee_user_id, access_level, created_by)
    values (${values})`
}

describe('matter share grantee organisation constraint (db)', () => {
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

  async function scratchSchema(): Promise<string> {
    const schema = `matter_share_constraint_${schemaCount++}`
    await client.query(`create schema ${schema}`)
    await client.query(`set local search_path to ${schema}`)
    await client.query(`
      create table organisations (id text primary key);
      create table users (
        id text primary key,
        email text not null unique,
        "organisationId" text references organisations(id),
        role text
      );
      create table matters (
        id text primary key,
        organisation_id text not null references organisations(id),
        created_by text not null references users(id),
        unique (id, organisation_id)
      );
      create table matter_shares (
        id text primary key,
        organisation_id text not null,
        matter_id text not null,
        grantee_user_id text not null,
        access_level text not null,
        created_by text not null,
        created_at timestamptz not null default now(),
        constraint matter_shares_matter_fk foreign key (matter_id, organisation_id)
          references matters(id, organisation_id),
        constraint ${legacyConstraint} foreign key (grantee_user_id)
          references users(id) on delete cascade,
        constraint matter_shares_created_by_fk foreign key (created_by)
          references users(id),
        constraint matter_shares_matter_grantee_key unique (matter_id, grantee_user_id)
      );
    `)
    return schema
  }

  async function seedTwoOrganisations() {
    await client.query(
      `insert into organisations (id) values ('org_a'), ('org_b')`,
    )
    await client.query(`
      insert into users (id, email, "organisationId", role)
      values
        ('usr_a', 'a@example.com', 'org_a', 'owner'),
        ('usr_grantee', 'grantee@example.com', 'org_a', 'member'),
        ('usr_b', 'b@example.com', 'org_b', 'member'),
        ('usr_hist', 'hist@example.com', null, null)
    `)
    await client.query(`
      insert into matters (id, organisation_id, created_by)
      values ('mtr_a', 'org_a', 'usr_a')
    `)
  }

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

  async function constraintExists(name: string): Promise<boolean> {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
       where conrelid = 'matter_shares'::regclass and conname = $1`,
      [name],
    )
    return (rows[0]?.n ?? 0) > 0
  }

  it('accepts a cross-organisation grant before the migration', async () => {
    await scratchSchema()
    await seedTwoOrganisations()

    await expect(
      client.query(
        share(`'shr_pre', 'org_a', 'mtr_a', 'usr_b', 'view', 'usr_a'`),
      ),
    ).resolves.toBeDefined()
  })

  it('rejects a cross-organisation grant after the migration', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()

    await client.query('savepoint before_bad_grant')
    await expect(
      client.query(
        share(`'shr_bad', 'org_a', 'mtr_a', 'usr_b', 'view', 'usr_a'`),
      ),
    ).rejects.toThrow(new RegExp(compositeConstraint))
    await client.query('rollback to savepoint before_bad_grant')
  })

  it('accepts a same-organisation grant after the migration', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()

    await expect(
      client.query(
        share(`'shr_ok', 'org_a', 'mtr_a', 'usr_grantee', 'view', 'usr_a'`),
      ),
    ).resolves.toBeDefined()
  })

  it('rejects changing a grant to a grantee outside the organisation', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()
    await client.query(
      share(`'shr_ok', 'org_a', 'mtr_a', 'usr_grantee', 'view', 'usr_a'`),
    )

    await client.query('savepoint before_bad_update')
    await expect(
      client.query(
        `update matter_shares set grantee_user_id = 'usr_b' where id = 'shr_ok'`,
      ),
    ).rejects.toThrow(new RegExp(compositeConstraint))
    await client.query('rollback to savepoint before_bad_update')
  })

  it('rejects changing a user organisation while a share references it', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()
    await client.query(
      share(`'shr_ok', 'org_a', 'mtr_a', 'usr_grantee', 'view', 'usr_a'`),
    )

    await client.query('savepoint before_bad_membership_move')
    await expect(
      client.query(
        `update users set "organisationId" = 'org_b' where id = 'usr_grantee'`,
      ),
    ).rejects.toThrow(new RegExp(compositeConstraint))
    await client.query('rollback to savepoint before_bad_membership_move')

    await client.query('savepoint before_bad_membership_removal')
    await expect(
      client.query(
        `update users set "organisationId" = null where id = 'usr_grantee'`,
      ),
    ).rejects.toThrow(new RegExp(compositeConstraint))
    await client.query('rollback to savepoint before_bad_membership_removal')
  })

  it('cascades a grantee deletion to their shares', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()
    await client.query(
      share(`'shr_ok', 'org_a', 'mtr_a', 'usr_grantee', 'view', 'usr_a'`),
    )

    await client.query(`delete from users where id = 'usr_grantee'`)
    const remaining = await client.query<{ n: number }>(
      `select count(*)::int as n from matter_shares`,
    )
    expect(remaining.rows[0]?.n).toBe(0)
  })

  it('does not constrain created_by to the share organisation', async () => {
    await scratchSchema()
    await seedTwoOrganisations()
    expect(await runMigration()).toBeNull()

    await expect(
      client.query(
        share(
          `'shr_hist', 'org_a', 'mtr_a', 'usr_grantee', 'view', 'usr_hist'`,
        ),
      ),
    ).resolves.toBeDefined()
  })

  it('fails closed and applies nothing when a pre-existing row violates', async () => {
    const schema = await scratchSchema()
    await seedTwoOrganisations()
    await client.query(
      share(`'shr_pre', 'org_a', 'mtr_a', 'usr_b', 'view', 'usr_a'`),
    )

    const error = await runMigration()
    expect(error).toContain('P0.20')
    expect(error).toContain('Revoke them')
    const { rows } = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = $1 and indexname = 'users_id_organisation_key'`,
      [schema],
    )
    expect(rows).toHaveLength(0)
    expect(await constraintExists(compositeConstraint)).toBe(false)
    expect(await constraintExists(legacyConstraint)).toBe(true)
  })

  it('is idempotent', async () => {
    await scratchSchema()
    await seedTwoOrganisations()

    expect(await runMigration()).toBeNull()
    expect(await runMigration()).toBeNull()
    expect(await constraintExists(compositeConstraint)).toBe(true)
    expect(await constraintExists(legacyConstraint)).toBe(false)
  })
})
