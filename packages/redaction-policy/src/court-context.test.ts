import { describe, expect, it } from 'bun:test'

import { suppressCourtContextSpans } from './court-context'
import type { RedactionSpan, SpanCategory } from './types'

function span(
  text: string,
  start: number,
  end: number,
  category: SpanCategory,
): RedactionSpan {
  return {
    id: `${category}-${start}`,
    start,
    end,
    text: text.slice(start, end),
    category,
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

describe('suppressCourtContextSpans', () => {
  it('suppresses a claim number read as an identifier', () => {
    const text = 'Claim No. HQ18X01234 is listed for trial.'
    const start = text.indexOf('HQ18X01234')

    const kept = suppressCourtContextSpans(text, [
      span(text, start, start + 'HQ18X01234'.length, 'drivers_license'),
      span(text, 0, 5, 'person_name'),
    ])

    expect(kept.map(({ category }) => category)).toEqual(['person_name'])
  })

  it('suppresses a court place written before or after the court name', () => {
    const after = 'County Court at Leicester heard the claim.'
    const before = 'Leicester County Court heard the claim.'

    expect(
      suppressCourtContextSpans(after, [
        span(after, after.indexOf('Leicester'), after.length - 19, 'address'),
      ]),
    ).toEqual([])
    expect(
      suppressCourtContextSpans(before, [
        span(before, 0, 'Leicester'.length, 'address'),
      ]),
    ).toEqual([])
  })

  it('does not join a place across a line break', () => {
    const text = 'Leicester\nCounty Court heard the claim.'
    const address = span(text, 0, 'Leicester'.length, 'address')

    expect(suppressCourtContextSpans(text, [address])).toEqual([address])
  })

  it('never discards a span that a union widened over court detail', () => {
    const text = 'County Court at Leicester; Alice Smith attended.'
    const widened = span(
      text,
      text.indexOf('Leicester'),
      text.indexOf(' Smith'),
      'address',
    )

    expect(suppressCourtContextSpans(text, [widened])).toEqual([widened])
  })
})
