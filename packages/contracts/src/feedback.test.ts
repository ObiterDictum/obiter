import { describe, expect, it } from 'bun:test'
import { feedbackRequestSchema } from './feedback'

describe('feedback validation', () => {
  it('requires a bounded message and known kind', () => {
    for (const message of ['', '   ', 'x'.repeat(4001)]) {
      expect(
        feedbackRequestSchema.safeParse({ kind: 'problem', message }).success,
      ).toBe(false)
    }
    expect(
      feedbackRequestSchema.safeParse({
        kind: 'idea',
        message: 'Improve navigation',
      }).success,
    ).toBe(true)
  })
  it('strips query strings and fragments and rejects document data', () => {
    expect(
      feedbackRequestSchema.parse({
        kind: 'question',
        message: 'Help',
        path: '/matters/:id?secret=text#selection',
      }).path,
    ).toBe('/matters/:id')
    expect(
      feedbackRequestSchema.safeParse({
        kind: 'problem',
        message: 'Help',
        documentText: 'private',
      }).success,
    ).toBe(false)
  })
})
