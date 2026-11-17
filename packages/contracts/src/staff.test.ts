import { describe, expect, it } from 'bun:test'
import {
  staffDecisionInputSchema,
  staffFeedbackHandledInputSchema,
  staffFeedbackQuerySchema,
  staffUsageQuerySchema,
  staffUsageResponseSchema,
  staffBuzzAgents,
  staffBuzzKeyInputSchema,
  staffBuzzRolesInputSchema,
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

describe('staff Buzz access', () => {
  it('gives every staff member the staff agents and roles the rest', () => {
    expect(staffBuzzAgents([])).toEqual([
      'Clerk',
      'Reporter',
      'Scribe',
      'Examiner',
    ])
    expect(staffBuzzAgents(['operations', 'corpus'])).toEqual([
      'Clerk',
      'Reporter',
      'Scribe',
      'Examiner',
      'Registrar',
      'Archivist',
    ])
  })

  it('accepts a pasted npub and refuses anything else', () => {
    const npub =
      'npub1gutgpl9302edr9ch7mg90z5fxk962mgkdx7xxcyu57fr5a7j0ydqvucky8'
    expect(
      staffBuzzKeyInputSchema.parse({ npub: ` ${npub.toUpperCase()} ` }).npub,
    ).toBe(npub)
    expect(
      staffBuzzKeyInputSchema.safeParse({ npub: 'nsec1abc' }).success,
    ).toBe(false)
  })

  it('accepts only known roles', () => {
    expect(
      staffBuzzRolesInputSchema.safeParse({ roles: ['operations'] }).success,
    ).toBe(true)
    expect(
      staffBuzzRolesInputSchema.safeParse({ roles: ['owner'] }).success,
    ).toBe(false)
  })
})
