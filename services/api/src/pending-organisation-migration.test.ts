import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0016_pending_organisation_name.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('pending organisation name migration', () => {
  it('is an additive and repeatable users-column migration', () => {
    expect(migration).toContain(
      'alter table users add column if not exists "pendingOrganisationName" text',
    )
    expect(migration).not.toMatch(
      /create table|drop table|delete from|update /iu,
    )
  })
})
