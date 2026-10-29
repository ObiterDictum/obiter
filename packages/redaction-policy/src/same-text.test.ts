import { describe, expect, it } from 'bun:test'
import { mixedTextGroups, sameTextKey, sameTextOccurrences } from './same-text'
import type { RedactionSpan } from './types'

function span(id: string, text: string, start: number): RedactionSpan {
  return {
    id,
    start,
    end: start + text.length,
    text,
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

const spans = [
  span('span_1', 'Priya', 0),
  span('span_2', 'Priya ', 40),
  span('span_3', 'priya', 80),
  span('span_4', 'Shah', 120),
]

function decision(value: 'accept' | 'reject') {
  return {
    decision: value,
    decidedBy: 'usr_1',
    decidedAt: '2026-10-28T00:00:00.000Z',
  }
}

describe('same text across occurrences', () => {
  it('compares the words a reviewer reads, not the raw span text', () => {
    expect(sameTextKey('  Priya\nShah ')).toBe('priya shah')
    expect(sameTextOccurrences(spans, 'priya').map((item) => item.id)).toEqual([
      'span_1',
      'span_2',
      'span_3',
    ])
  })

  it('names every group where the same text is decided both ways', () => {
    const groups = mixedTextGroups(spans, {
      span_1: decision('accept'),
      span_2: decision('reject'),
      span_3: decision('accept'),
      span_4: decision('accept'),
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.text).toBe('Priya')
    expect(groups[0]?.removed).toEqual(['span_1', 'span_3'])
    expect(groups[0]?.kept).toEqual(['span_2'])
  })

  it('treats a pseudonymised occurrence as removed, not as a disagreement', () => {
    expect(
      mixedTextGroups(spans, {
        span_1: { ...decision('accept'), decision: 'pseudonymise' },
        span_2: decision('accept'),
        span_3: decision('accept'),
      }),
    ).toEqual([])
  })

  it('leaves an undecided occurrence out: it blocks finalising on its own', () => {
    expect(
      mixedTextGroups(spans, {
        span_1: decision('accept'),
        span_2: decision('accept'),
      }),
    ).toEqual([])
  })
})
