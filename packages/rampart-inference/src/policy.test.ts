import { describe, expect, it } from 'bun:test'
import { mergeSpans } from './policy'
import type { PiiLabel, Span } from './types'

function span(
  start: number,
  end: number,
  label: PiiLabel,
  score: number,
  source: Span['source'],
): Span {
  return { start, end, label, score, source, text: 'x'.repeat(end - start) }
}

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

  it('prefers the higher-confidence span when two spans partially overlap', () => {
    const merged = mergeSpans([
      span(0, 5, 'GIVEN_NAME', 0.6, 'ner'),
      span(3, 8, 'EMAIL', 0.9, 'ner'),
    ])
    expect(merged).toEqual([
      expect.objectContaining({ start: 0, end: 8, label: 'EMAIL' }),
    ])
  })

  it('prefers the longer span when confidence ties', () => {
    const merged = mergeSpans([
      span(0, 4, 'SSN', 1, 'ner'),
      span(2, 9, 'EMAIL', 1, 'ner'),
    ])
    expect(merged).toEqual([
      expect.objectContaining({ start: 0, end: 9, label: 'EMAIL' }),
    ])
  })

  it('prefers the heuristic span when confidence and length tie', () => {
    const merged = mergeSpans([
      span(0, 4, 'SSN', 1, 'ner'),
      span(2, 6, 'EMAIL', 1, 'heuristic'),
    ])
    expect(merged).toEqual([
      expect.objectContaining({ start: 0, end: 6, label: 'EMAIL' }),
    ])
  })

  it('collapses a contained overlap to the winner instead of unioning the bytes', () => {
    const merged = mergeSpans([
      span(0, 10, 'SSN', 0.5, 'ner'),
      span(2, 5, 'EMAIL', 0.9, 'heuristic'),
    ])
    expect(merged).toEqual([
      expect.objectContaining({ start: 2, end: 5, label: 'EMAIL' }),
    ])
  })
})
