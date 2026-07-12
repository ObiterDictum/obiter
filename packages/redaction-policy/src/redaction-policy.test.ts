import { describe, expect, it } from 'vitest'
import {
  chunkText,
  mapRampartSpans,
  mergeSpans,
  reassembleSpans,
  supplementSpans,
} from './index'
import type { RedactionSpan } from './types'

const legalText = `Jane Smith of 10 Downing Street emailed jane.smith@example.com about matter CR-2024-00123. Her NI number is QQ 12 34 56 C. Smith & Jones Solicitors LLP act for the claimant.`

describe('redaction policy', () => {
  it('maps Rampart labels to Obiter categories', () => {
    const start = legalText.indexOf('Jane Smith')
    const spans = mapRampartSpans({
      text: legalText,
      spans: [
        {
          start,
          end: start + 'Jane Smith'.length,
          label: 'GIVEN_NAME',
          score: 0.9,
        },
      ],
    })
    expect(spans[0]?.category).toBe('person_name')
    expect(spans[0]?.source).toBe('rampart_model')
    expect(spans[0]?.suggestion).toBe('redact')
  })

  it('maps the address component labels the model actually emits', () => {
    // CITY/STATE/ZIP_CODE verified present in the model label space (spike, July 2026);
    // they fire on virtually every UK address ("Leicester", "LE4 5AB").
    const spans = mapRampartSpans({
      text: 'Leicester LE4 5AB',
      spans: [
        { start: 0, end: 9, label: 'CITY', score: 0.99 },
        { start: 10, end: 17, label: 'ZIP_CODE', score: 0.99 },
      ],
    })
    expect(spans.map((span) => span.category)).toEqual(['address', 'address'])
  })

  it('fails loudly for unknown Rampart labels', () => {
    expect(() =>
      mapRampartSpans({
        text: legalText,
        spans: [{ start: 0, end: 4, label: 'UNKNOWN' }],
      }),
    ).toThrow('Unrecognised Rampart label')
  })

  it('detects UK legal supplement spans', () => {
    const spans = supplementSpans(legalText)
    expect(spans.map((span) => span.category)).toEqual(
      expect.arrayContaining([
        'national_insurance',
        'case_reference',
        'organisation_name',
      ]),
    )
  })

  it('deduplicates overlaps with Rampart winning', () => {
    const rampart: RedactionSpan = {
      id: 'span_r',
      start: 0,
      end: 10,
      text: 'Jane Smith',
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    }
    const supplement: RedactionSpan = {
      id: 'span_s',
      start: 5,
      end: 10,
      text: 'Smith',
      category: 'organisation_name',
      source: 'uk_supplement',
      confidence: 'low',
      suggestion: 'keep',
    }
    expect(mergeSpans([rampart], [supplement])).toEqual([rampart])
  })

  it('preserves non-overlapping spans', () => {
    const rampart = mapRampartSpans({
      text: legalText,
      spans: [{ start: 0, end: 10, label: 'GIVEN_NAME' }],
    })
    const supplement = supplementSpans(legalText).filter(
      (span) => span.category === 'national_insurance',
    )
    expect(mergeSpans(rampart, supplement)).toHaveLength(2)
  })

  it('chunks text and reassembles offsets', () => {
    const text = Array.from(
      { length: 900 },
      (_, index) => `token${index}`,
    ).join(' ')
    const chunks = chunkText(text, 400)
    expect(chunks.length).toBeGreaterThan(1)
    const target = 'token450'
    const chunk = chunks.find((item) => item.text.includes(target))
    expect(chunk).toBeDefined()
    const localStart = chunk!.text.indexOf(target)
    const spans = reassembleSpans([
      {
        chunkOffset: chunk!.startOffset,
        spans: [
          {
            id: 'span',
            start: localStart,
            end: localStart + target.length,
            text: target,
            category: 'case_reference',
            source: 'uk_supplement',
            confidence: 'medium',
            suggestion: 'keep',
          },
        ],
      },
    ])
    expect(spans[0]?.start).toBe(text.indexOf(target))
  })

  it('returns empty arrays for empty input', () => {
    expect(supplementSpans('')).toEqual([])
    expect(chunkText('')).toEqual([])
  })
})
