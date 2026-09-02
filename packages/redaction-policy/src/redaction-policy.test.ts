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

  it('drops model-brand person_name false positives', () => {
    const spans = mapRampartSpans({
      text: 'Kimi K3 and Claude run in the fleet.',
      spans: [
        { start: 0, end: 4, label: 'GIVEN_NAME', score: 0.7, text: 'Kimi' },
        { start: 12, end: 18, label: 'GIVEN_NAME', score: 0.8, text: 'Claude' },
        { start: 30, end: 35, label: 'GIVEN_NAME', score: 0.9, text: 'fleet' },
      ],
    })
    expect(spans.map((span) => span.text)).toEqual(['fleet'])
  })

  it('trims honorifics and salutations swept into person spans', () => {
    // The classifier's particle rescue widens name spans across short
    // capitalised tokens, so a span arrives as "Dear Ms Amara" when the model
    // only tagged "Amara". The name must survive; the salutation must not.
    const text = 'Dear Ms Amara Okonkwo, our client Dr Fairbairn agrees.'
    const spans = mapRampartSpans({
      text,
      spans: [
        { start: 0, end: 13, label: 'GIVEN_NAME', score: 0.99 },
        {
          start: text.indexOf('Dr Fairbairn'),
          end: text.indexOf('Dr Fairbairn') + 'Dr Fairbairn'.length,
          label: 'SURNAME',
          score: 0.94,
        },
      ],
    })
    expect(spans.map((span) => span.text)).toEqual(['Amara', 'Fairbairn'])
    // Offsets must still point at the name in the source text, or the cover
    // geometry would black out the wrong characters.
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      'Amara',
      'Fairbairn',
    ])
  })

  it('keeps names that merely start with title-like letters', () => {
    const text = 'Mrs Missouri Drake and Miss Doe attended.'
    const spans = mapRampartSpans({
      text,
      spans: [
        { start: 0, end: 18, label: 'GIVEN_NAME', score: 0.9 },
        {
          start: text.indexOf('Miss Doe'),
          end: text.indexOf('Miss Doe') + 'Miss Doe'.length,
          label: 'SURNAME',
          score: 0.9,
        },
      ],
    })
    expect(spans.map((span) => span.text)).toEqual(['Missouri Drake', 'Doe'])
  })

  it('drops a person span that was only a title', () => {
    const spans = mapRampartSpans({
      text: 'Dear Sir, please advise.',
      spans: [{ start: 0, end: 8, label: 'GIVEN_NAME', score: 0.5 }],
    })
    expect(spans).toEqual([])
  })

  it('leaves non-person categories untrimmed', () => {
    // "Dr" is a road abbreviation in an address, not an honorific.
    const spans = mapRampartSpans({
      text: 'Mount Dr, Bristol',
      spans: [{ start: 0, end: 8, label: 'STREET_NAME', score: 0.97 }],
    })
    expect(spans.map((span) => span.text)).toEqual(['Mount Dr'])
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

  it('covers a full National Insurance number when a truncated model span overlaps', () => {
    const text = 'National Insurance number is QQ 12 34 56 C.'
    const full = 'QQ 12 34 56 C'
    const truncated = 'Q 12 34 56'
    const fullStart = text.indexOf(full)
    const truncatedStart = text.indexOf(truncated, fullStart + 1)
    const merged = mergeSpans(
      [
        {
          id: 'span_r',
          start: truncatedStart,
          end: truncatedStart + truncated.length,
          text: truncated,
          category: 'drivers_license',
          source: 'rampart_model',
          confidence: 'medium',
          suggestion: 'redact',
        },
      ],
      [
        {
          id: 'span_s',
          start: fullStart,
          end: fullStart + full.length,
          text: full,
          category: 'national_insurance',
          source: 'uk_supplement',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
    )
    expect(
      merged.some(
        (span) =>
          span.start <= fullStart && span.end >= fullStart + full.length,
      ),
    ).toBe(true)
  })

  it('covers a full sort code when a truncated model span overlaps', () => {
    const text = 'sort code 20-00-00, account number 12345678.'
    const full = '20-00-00'
    const truncated = '00-00'
    const fullStart = text.indexOf(full)
    const truncatedStart = text.indexOf(truncated, fullStart)
    const merged = mergeSpans(
      [
        {
          id: 'span_r',
          start: truncatedStart,
          end: truncatedStart + truncated.length,
          text: truncated,
          category: 'address',
          source: 'rampart_model',
          confidence: 'low',
          suggestion: 'redact',
        },
      ],
      [
        {
          id: 'span_s',
          start: fullStart,
          end: fullStart + full.length,
          text: full,
          category: 'account_number',
          source: 'uk_supplement',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
    )
    expect(
      merged.some(
        (span) =>
          span.start <= fullStart && span.end >= fullStart + full.length,
      ),
    ).toBe(true)
  })

  it('keeps a date-of-birth suggestion of redact through the merge', () => {
    const text = 'My date of birth is 12 March 1979.'
    const dob = '12 March 1979'
    const start = text.indexOf(dob)
    const merged = mergeSpans(
      [
        {
          id: 'span_dob',
          start,
          end: start + dob.length,
          text: dob,
          category: 'date',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
      [],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.suggestion).toBe('redact')
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
