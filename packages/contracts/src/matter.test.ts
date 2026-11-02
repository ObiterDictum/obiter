import { describe, expect, it } from 'bun:test'
import {
  matterTransferRequestSchema,
  memberOwnedMattersResponseSchema,
  removeOrganisationMemberConflictResponseSchema,
  removeOrganisationMemberRequestSchema,
  removeOrganisationMemberResponseSchema,
} from './matter'

describe('matter ownership contracts', () => {
  it('accepts legacy removal without transfers and explicit per-matter transfers', () => {
    expect(removeOrganisationMemberRequestSchema.parse({})).toEqual({})
    const input = { transfers: [{ matterId: 'm1', newOwnerUserId: 'u2' }] }
    expect(removeOrganisationMemberRequestSchema.parse(input)).toEqual(input)
    expect(
      removeOrganisationMemberResponseSchema.parse(undefined),
    ).toBeUndefined()
  })
  it('requires nonempty matter and replacement identifiers', () => {
    expect(
      matterTransferRequestSchema.safeParse({ newOwnerUserId: '' }).success,
    ).toBe(false)
    expect(
      removeOrganisationMemberRequestSchema.safeParse({
        transfers: [{ matterId: '', newOwnerUserId: 'u2' }],
      }).success,
    ).toBe(false)
  })
  it('validates owned-matter summaries and the structured conflict envelope', () => {
    const matters = [{ matterId: 'm1', title: 'Synthetic matter' }]
    expect(memberOwnedMattersResponseSchema.parse({ matters })).toEqual({
      matters,
    })
    const conflict = {
      error: {
        code: 'conflict_detected' as const,
        message: 'Transfer required.',
        requestId: 'req_1',
        uncoveredMatters: matters,
      },
    }
    expect(
      removeOrganisationMemberConflictResponseSchema.parse(conflict),
    ).toEqual(conflict)
    expect(
      removeOrganisationMemberConflictResponseSchema.safeParse({
        error: { ...conflict.error, uncoveredMatters: [{ matterId: 'm1' }] },
      }).success,
    ).toBe(false)
  })
})
