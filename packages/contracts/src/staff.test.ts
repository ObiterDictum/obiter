import { describe, expect, it } from 'bun:test'
import {
  staffDecisionInputSchema,
  staffFeedbackHandledInputSchema,
  staffFeedbackQuerySchema,
  staffUsageQuerySchema,
  staffUsageResponseSchema,
} from './staff'

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

describe('staff usage query', () => {
  it('defaults to a twelve week window and coerces the query string', () => {
    expect(staffUsageQuerySchema.parse({})).toEqual({ weeks: 12 })
    expect(staffUsageQuerySchema.parse({ weeks: '4' })).toEqual({ weeks: 4 })
  })

  it('refuses a window outside one to fifty-two weeks', () => {
    expect(staffUsageQuerySchema.safeParse({ weeks: '0' }).success).toBe(false)
    expect(staffUsageQuerySchema.safeParse({ weeks: '53' }).success).toBe(false)
    expect(staffUsageQuerySchema.safeParse({ weeks: 'x' }).success).toBe(false)
  })
})

describe('staff usage response', () => {
  it('accepts an empty window with no organisations or cohorts', () => {
    expect(
      staffUsageResponseSchema.safeParse({
        windowWeeks: 12,
        weeks: [],
        organisations: [],
        retention: [],
      }).success,
    ).toBe(true)
  })
})

describe('staff feedback', () => {
  it('defaults the list to open messages and accepts kind and status filters', () => {
    expect(staffFeedbackQuerySchema.parse({})).toEqual({ status: 'open' })
    expect(
      staffFeedbackQuerySchema.parse({ kind: 'idea', status: 'all' }),
    ).toEqual({ kind: 'idea', status: 'all' })
    expect(staffFeedbackQuerySchema.safeParse({ kind: 'praise' }).success).toBe(
      false,
    )
  })

  it('requires an explicit handled boolean', () => {
    expect(staffFeedbackHandledInputSchema.safeParse({}).success).toBe(false)
    expect(staffFeedbackHandledInputSchema.parse({ handled: true })).toEqual({
      handled: true,
    })
  })
})
