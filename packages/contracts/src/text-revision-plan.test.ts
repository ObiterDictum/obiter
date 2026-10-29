import { describe, expect, it } from 'bun:test'

import { planTextRevision } from './text-revision-plan'

describe('planTextRevision', () => {
  it('expands a word-level edit to whole words and keeps the shared edges equal', () => {
    const plan = planTextRevision(
      'the quick brown fox',
      'the slow brown fox',
      true,
    )

    expect(plan).toMatchObject({
      kind: 'granular',
      removed: 'quick',
      inserted: 'slow',
    })
    expect('the quick brown fox'.slice(0, plan.prefixLength)).toBe(
      'the slow brown fox'.slice(0, plan.prefixLength),
    )
    expect(
      'the quick brown fox'.slice(plan.prefixLength + plan.removed.length),
    ).toBe('the slow brown fox'.slice(plan.prefixLength + plan.inserted.length))
  })

  it('keeps a non-breaking space inside the token so a quantity keeps its unit', () => {
    const plan = planTextRevision('10\u00a0kg', '12\u00a0kg', true)

    expect(plan).toMatchObject({
      removed: '10\u00a0kg',
      inserted: '12\u00a0kg',
    })
  })

  it('treats a line-ending difference as no change', () => {
    expect(planTextRevision('a\r\nb', 'a\nb', true)).toMatchObject({
      kind: 'noop',
    })
  })

  it('falls back to a whole-run revision when the edit is not word-granular', () => {
    expect(planTextRevision('one two', 'one three', false)).toMatchObject({
      kind: 'whole-run',
      reason: 'ineligible',
    })
    expect(
      planTextRevision('one two', 'one three', true, [], true),
    ).toMatchObject({ kind: 'whole-run', reason: 'pending-properties' })
  })
})
