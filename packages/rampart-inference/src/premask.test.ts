import { describe, expect, it } from 'bun:test'
import { premask, projectMaskedSpan } from './premask'
import type { PiiLabel, Span } from './types'

function heuristic(start: number, end: number, label: PiiLabel, text: string): Span {
  return { start, end, label, score: 1, source: 'heuristic', text }
}

describe('premask', () => {
  it('replaces a detected span with its label sentinel', () => {
    const raw = 'call 123-45-6789 now'
    expect(premask(raw, [heuristic(5, 16, 'SSN', '123-45-6789')]).masked).toBe(
      'call [SSN] now',
    )
  })

  it('maps every sentinel character onto the whole source span it stands for', () => {
    const result = premask('123-45-6789', [
      heuristic(0, 11, 'SSN', '123-45-6789'),
    ])
    expect(result.masked).toBe('[SSN]')
    expect(result.rawStart).toEqual([0, 0, 0, 0, 0])
    expect(result.rawEnd).toEqual([11, 11, 11, 11, 11])
  })

  it('leaves text outside the detected spans verbatim and mapped one to one', () => {
    const result = premask('a 123-45-6789 b', [
      heuristic(2, 13, 'SSN', '123-45-6789'),
    ])
    expect(result.masked).toBe('a [SSN] b')
    expect(result.rawStart.slice(0, 2)).toEqual([0, 1])
    expect(result.rawEnd.slice(-2)).toEqual([14, 15])
  })

  it('merges overlapping spans first so their union is masked once', () => {
    const result = premask('abcdef', [
      heuristic(0, 4, 'SSN', 'abcd'),
      heuristic(2, 6, 'GIVEN_NAME', 'cdef'),
    ])
    expect(result.masked).toBe('[SSN]')
  })
})

describe('projectMaskedSpan', () => {
  it('projects a span inside a sentinel back onto the whole raw span it stands for', () => {
    const raw = 'call 123-45-6789 now'
    const map = premask(raw, [heuristic(5, 16, 'SSN', '123-45-6789')])
    const projected = projectMaskedSpan(
      { start: 6, end: 8, label: 'SSN', score: 0.5, source: 'ner', text: '[S' },
      raw,
      map,
    )
    expect(projected).toMatchObject({ start: 5, end: 16, text: '123-45-6789' })
  })

  it('returns null for an empty span', () => {
    const raw = 'abc'
    const map = premask(raw, [])
    expect(
      projectMaskedSpan(
        { start: 1, end: 1, label: 'SSN', score: 0.5, source: 'ner', text: '' },
        raw,
        map,
      ),
    ).toBeNull()
  })
})
