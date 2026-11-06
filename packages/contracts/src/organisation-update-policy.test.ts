import { expect, it } from 'bun:test'
import { organisationUpdatePolicySchema } from './organisation-update-policy'

it('accepts explicit opt in and opt out, rejecting missing, coerced and unknown fields', () => {
  for (const requireUpdates of [true, false])
    expect(organisationUpdatePolicySchema.parse({ requireUpdates })).toEqual({
      requireUpdates,
    })
  for (const input of [
    {},
    { requireUpdates: 'false' },
    { requireUpdates: false, extra: true },
  ])
    expect(organisationUpdatePolicySchema.safeParse(input).success).toBe(false)
})
