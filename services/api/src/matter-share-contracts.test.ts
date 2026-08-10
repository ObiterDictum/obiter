import { describe, expect, it } from 'vitest'
import {
  matterAccessDecisionSchema,
  matterAccessLevelSchema,
  matterShareCreateRequestSchema,
  matterShareListResponseSchema,
} from '@obiter/contracts'

const validShare = {
  id: 'shr_1',
  matterId: 'mtr_1',
  granteeUserId: 'usr_grantee',
  accessLevel: 'view',
  createdBy: 'usr_owner',
  createdAt: '2026-08-10T12:00:00.000Z',
}

describe('matter share contracts', () => {
  it('parses only the supported access levels and decisions', () => {
    expect(matterAccessLevelSchema.parse('view')).toBe('view')
    expect(matterAccessLevelSchema.parse('edit')).toBe('edit')
    expect(matterAccessLevelSchema.safeParse('denied').success).toBe(false)
    expect(matterAccessLevelSchema.safeParse('admin').success).toBe(false)

    expect(matterAccessDecisionSchema.parse('denied')).toBe('denied')
  })

  it('validates create requests with the shared access-level schema', () => {
    expect(
      matterShareCreateRequestSchema.parse({
        granteeUserId: 'usr_grantee',
        accessLevel: 'edit',
      }),
    ).toEqual({ granteeUserId: 'usr_grantee', accessLevel: 'edit' })
    expect(
      matterShareCreateRequestSchema.safeParse({
        granteeUserId: 'usr_grantee',
        accessLevel: 'owner',
      }).success,
    ).toBe(false)
  })

  it('rejects malformed share response data', () => {
    expect(
      matterShareListResponseSchema.parse({
        ownerUserId: 'usr_owner',
        shares: [validShare],
      }),
    ).toEqual({ ownerUserId: 'usr_owner', shares: [validShare] })
    expect(
      matterShareListResponseSchema.safeParse({
        ownerUserId: 'usr_owner',
        shares: [{ ...validShare, accessLevel: 'owner' }],
      }).success,
    ).toBe(false)
    expect(
      matterShareListResponseSchema.safeParse({
        ownerUserId: 'usr_owner',
        shares: [{ ...validShare, createdAt: 'yesterday' }],
      }).success,
    ).toBe(false)
  })
})
