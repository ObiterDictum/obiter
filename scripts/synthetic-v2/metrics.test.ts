import { describe, expect, it } from 'vitest'
import { evaluateSpans, hardNegativeFalsePositiveRate } from './metrics'

describe('benchmark span metrics', () => {
  it('reports per-category and role-confusion metrics', () => {
    const report = evaluateSpans([
      {
        id: 'one',
        gold: [{ category: 'person_private', start: 0, end: 5, text: 'Alice' }],
        predicted: [
          { category: 'person_protected', start: 0, end: 5, text: 'Alice' },
        ],
      },
    ])
    expect(report.overall.f1).toBe(0)
    expect(report.roleConfusion).toEqual({
      'person_private->person_protected': 1,
    })
    expect(report.documentExactMatchRate).toBe(0)
  })
  it('does not collapse matching offsets from separate documents', () => {
    const span = {
      category: 'person_private' as const,
      start: 0,
      end: 5,
      text: 'Alice',
    }
    expect(
      evaluateSpans([
        { id: 'one', gold: [span], predicted: [span] },
        { id: 'two', gold: [span], predicted: [] },
      ]).overall.recall,
    ).toBe(0.5)
  })

  it('reports hard-negative false-positive rate', () => {
    expect(hardNegativeFalsePositiveRate(20, 1)).toBe(0.05)
  })
})
