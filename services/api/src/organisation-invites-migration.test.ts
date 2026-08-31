import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0015_organisation_invites.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('organisation invites migration', () => {
  it('is an additive and repeatable new-table migration', () => {
    expect(migration).toContain(
      'create table if not exists organisation_invites',
    )
    expect(migration).toContain(
      "constraint organisation_invites_id_prefix_check check (id like 'inv_%')",
    )
    expect(migration.match(/create unique index if not exists/gu)).toHaveLength(
      2,
    )
    expect(migration).not.toMatch(
      /alter table|drop table|delete from|update /iu,
    )
  })

  it('stores one open invite per organisation email and hashes the token', () => {
    expect(migration).toContain(
      'on organisation_invites (organisation_id, email)\n  where accepted_at is null and revoked_at is null',
    )
    expect(migration).toContain('token_hash text not null')
    expect(migration).toContain('email = lower(email)')
  })
})
