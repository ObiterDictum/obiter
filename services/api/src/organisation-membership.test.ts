import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  inviteUnavailability,
  moveUserAndDeleteEmptyOrganisation,
} from './organisation-membership'

describe('inviteUnavailability', () => {
  const open = {
    accepted_at: null,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }

  it('returns invite_not_found when the token matches no row', () => {
    expect(inviteUnavailability(undefined)).toMatchObject({
      code: 'invite_not_found',
    })
  })

  it('returns invite_already_accepted before expiry', () => {
    expect(
      inviteUnavailability({
        ...open,
        accepted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toMatchObject({ code: 'invite_already_accepted' })
  })

  it('returns invite_revoked before expiry', () => {
    expect(
      inviteUnavailability({
        ...open,
        revoked_at: new Date().toISOString(),
      }),
    ).toMatchObject({ code: 'invite_revoked' })
  })

  it('returns invite_expired for an open invite past expires_at', () => {
    expect(
      inviteUnavailability({
        ...open,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toMatchObject({ code: 'invite_expired' })
  })

  it('returns null for an open unexpired invite', () => {
    expect(inviteUnavailability(open)).toBeNull()
  })
})

describe('moveUserAndDeleteEmptyOrganisation', () => {
  it('reassigns audit rows to the destination organisation instead of nulling them', async () => {
    const statements: { sql: string; params: unknown[] }[] = []
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params })
        return { rows: [] }
      },
    } as unknown as PoolClient

    await moveUserAndDeleteEmptyOrganisation(client, {
      userId: 'usr_1',
      fromOrganisationId: 'org_from',
      toOrganisationId: 'org_to',
      role: 'member',
    })

    const audit = statements.find((statement) =>
      statement.sql.includes('audit_logs'),
    )
    expect(audit).toBeDefined()
    expect(audit?.sql).not.toMatch(/organisation_id\s*=\s*null/i)
    expect(audit?.params).toEqual(['org_to', 'org_from'])
  })
})
