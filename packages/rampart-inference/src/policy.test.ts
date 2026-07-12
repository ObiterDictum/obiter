import { describe, expect, it } from 'vitest'
import { mergeSpans } from './policy'

describe('mergeSpans', () => {
  it('unions partially overlapping heuristic and NER spans under the preferred label', () => {
    const spans = mergeSpans([
      {
        start: 4,
        end: 12,
        label: 'EMAIL',
        score: 1,
        source: 'heuristic',
        text: 'email',
      },
      {
        start: 0,
        end: 8,
        label: 'GIVEN_NAME',
        score: 0.99,
        source: 'ner',
        text: 'name',
      },
    ])

    expect(spans).toEqual([
      expect.objectContaining({
        start: 0,
        end: 12,
        label: 'EMAIL',
        source: 'heuristic',
      }),
    ])
  })
})
