import { describe, expect, it } from 'bun:test'
import { staffDecisionInputSchema } from './staff'

describe('staff decisions', () => {
  it('requires an explicit domain or person target', () => {
    expect(
      staffDecisionInputSchema.safeParse({ decision: 'approve', target: {} })
        .success,
    ).toBe(false)
    expect(
      staffDecisionInputSchema.parse({
        decision: 'decline',
        target: { kind: 'domain', domain: 'Example.test' },
      }).target,
    ).toEqual({ kind: 'domain', domain: 'example.test' })
  })
})
