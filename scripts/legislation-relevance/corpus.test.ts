import { describe, expect, it } from 'vitest'
import { readAppliedSearchParameters } from './corpus'

describe('legislation relevance corpus boundary', () => {
  it('reads the parameters the server reported applying', () => {
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: 0.35,
      }),
    ).toEqual({ matchingStrategy: 'all', rankingScoreThreshold: 0.35 })
    // An explicit null is a real value: the server applied no floor.
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: null,
      }),
    ).toEqual({ matchingStrategy: 'all', rankingScoreThreshold: null })
  })

  it('rejects a report that does not state what it applied', () => {
    // A missing field is not "no floor". An absent observation must stay
    // absent so run.ts refuses, rather than being recorded as a condition.
    expect(readAppliedSearchParameters(undefined)).toBe(null)
    expect(readAppliedSearchParameters(null)).toBe(null)
    expect(readAppliedSearchParameters({ matchingStrategy: 'all' })).toBe(null)
    expect(readAppliedSearchParameters({ rankingScoreThreshold: 0.35 })).toBe(
      null,
    )
    expect(
      readAppliedSearchParameters({
        matchingStrategy: 'all',
        rankingScoreThreshold: 'none',
      }),
    ).toBe(null)
  })
})
