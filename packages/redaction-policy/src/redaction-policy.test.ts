import { describe, expect, it } from 'bun:test'
import {
  chunkText,
  mapRampartSpans,
  mergeSpans,
  normalizePersonDetections,
  reassembleSpans,
  reconcileRampartSpans,
  supplementSpans,
} from './index'
import type { RampartSpanInput } from './rampart-map'
import type { RedactionSpan } from './types'

/**
 * The production order for a set of contributing detections: normalise the
 * person spans, then map. The mapper is heuristic-free; normalisation happens
 * before the union so a heuristic only ever judges a single detection (P0.30).
 */
function mapNormalized(text: string, spans: RampartSpanInput[]) {
  return mapRampartSpans({
    text,
    spans: normalizePersonDetections(text, spans),
  })
}

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
    const spans = mapNormalized('Kimi K3 and Claude run in the fleet.', [
      { start: 0, end: 4, label: 'GIVEN_NAME', score: 0.7, text: 'Kimi' },
      { start: 12, end: 18, label: 'GIVEN_NAME', score: 0.8, text: 'Claude' },
      { start: 30, end: 35, label: 'GIVEN_NAME', score: 0.9, text: 'fleet' },
    ])
    expect(spans.map((span) => span.text)).toEqual(['fleet'])
  })

  it('trims honorifics and salutations swept into person spans', () => {
    // The classifier's particle rescue widens name spans across short
    // capitalised tokens, so a span arrives as "Dear Ms Amara" when the model
    // only tagged "Amara". The name must survive; the salutation must not.
    const text = 'Dear Ms Amara Okonkwo, our client Dr Fairbairn agrees.'
    const spans = mapNormalized(text, [
      { start: 0, end: 13, label: 'GIVEN_NAME', score: 0.99 },
      {
        start: text.indexOf('Dr Fairbairn'),
        end: text.indexOf('Dr Fairbairn') + 'Dr Fairbairn'.length,
        label: 'SURNAME',
        score: 0.94,
      },
    ])
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
    const spans = mapNormalized(text, [
      { start: 0, end: 18, label: 'GIVEN_NAME', score: 0.9 },
      {
        start: text.indexOf('Miss Doe'),
        end: text.indexOf('Miss Doe') + 'Miss Doe'.length,
        label: 'SURNAME',
        score: 0.9,
      },
    ])
    expect(spans.map((span) => span.text)).toEqual(['Missouri Drake', 'Doe'])
  })

  it('drops a person span that was only a title', () => {
    const spans = mapNormalized('Dear Sir, please advise.', [
      { start: 0, end: 8, label: 'GIVEN_NAME', score: 0.5 },
    ])
    expect(spans).toEqual([])
  })

  it('normalises each detection and leaves other categories untouched', () => {
    const text = 'Dear Ms Amara Okonkwo of Leicester'
    const normalized = normalizePersonDetections(text, [
      { start: 0, end: 21, label: 'GIVEN_NAME', score: 0.99 },
      { start: 25, end: 34, label: 'CITY', score: 0.9 },
    ])
    expect(normalized.map((span) => text.slice(span.start, span.end))).toEqual([
      'Amara Okonkwo',
      'Leicester',
    ])
  })

  it('still trims a lone honorific and still denies lone heading glue', () => {
    expect(
      mapNormalized('Mr. Smith attended.', [
        { start: 0, end: 9, label: 'GIVEN_NAME', score: 0.9 },
      ]).map((span) => span.text),
    ).toEqual(['Smith'])
    expect(
      mapNormalized('Jones\nLaw', [
        { start: 0, end: 9, label: 'GIVEN_NAME', score: 0.9 },
      ]),
    ).toEqual([])
  })

  it('maps an already-normalised union without re-applying person heuristics', () => {
    // P0.30: the union is wider than either contributing detection, so trimming
    // or denying it here would discard the losing contributor's bytes. The
    // caller normalises before the union; the mapper must not do it again.
    const text = 'Dr Smith Street'
    const spans = mapRampartSpans({
      text,
      spans: [{ start: 0, end: 15, label: 'SURNAME', score: 0.9 }],
    })
    expect(spans.map((span) => span.text)).toEqual(['Dr Smith Street'])
  })

  it('maps an already-normalised union that contains a line break', () => {
    // The break belonged to a contributing detection denied before the merge,
    // or to a non-person detection; the mapper must not re-deny the union.
    const text = 'Jo\nnes Smith'
    const spans = mapRampartSpans({
      text,
      spans: [{ start: 0, end: 12, label: 'SURNAME', score: 0.9 }],
    })
    expect(spans.map((span) => span.text)).toEqual(['Jo\nnes Smith'])
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

  it('re-slices merged spans from the source so text always matches offsets', () => {
    // Upstream's partial-overlap union widens start/end but keeps the winner's
    // text, so a merged span can arrive with text that disagrees with its
    // offsets. Finalize and the .docx burner require text.slice(start, end) ===
    // text; the mapper must derive text from the source, not inherit it.
    const text = 'Alice alice@example.com'
    const spans = mapRampartSpans({
      text,
      spans: [
        {
          start: 0,
          end: 23,
          label: 'EMAIL',
          score: 1,
          text: 'alice@example.com',
        },
      ],
    })

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe(text)
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(spans[0]?.text)
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

/**
 * P0.31: `reconcileRampartSpans` owns coverage and disposition *between*
 * detections. URL is the only keep category the product can emit; GIVEN_NAME and
 * SURNAME are redact. These exercise geometry directly, without the detector's
 * premask and projection in the way.
 */
describe('reconcileRampartSpans (P0.31)', () => {
  const text = 'alpha bravo charlie delta'
  const at = (word: string, source = text) => {
    const start = source.indexOf(word)
    return { start, end: start + word.length, text: word }
  }
  const span = (
    label: string,
    range: { start: number; end: number; text: string },
    score: number,
  ): RampartSpanInput => ({ label, score, ...range })
  const reconcile = (value: string, spans: RampartSpanInput[]) =>
    reconcileRampartSpans(value, normalizePersonDetections(value, spans))

  it('redacts a partial union whose preferred detection would keep', () => {
    const spans = reconcile(text, [
      span('URL', { start: 6, end: 17, text: 'bravo charl' }, 0.99),
      span('GIVEN_NAME', at('charlie'), 0.5),
    ])
    expect(spans).toEqual([
      expect.objectContaining({
        start: 6,
        end: 19,
        text: 'bravo charlie',
        // The winner's category and source stay; only the disposition moves.
        category: 'url',
        source: 'rampart_deterministic',
        confidence: 'high',
        suggestion: 'redact',
      }),
    ])
  })

  it('redacts containment in both directions and covers the container', () => {
    const keepContainsRedact = reconcile(text, [
      span('URL', at('bravo charlie'), 0.99),
      span('GIVEN_NAME', at('charlie'), 0.5),
    ])
    const redactContainsKeep = reconcile(text, [
      span('GIVEN_NAME', at('bravo charlie'), 0.5),
      span('URL', at('charlie'), 0.99),
    ])
    for (const spans of [keepContainsRedact, redactContainsKeep]) {
      expect(spans).toHaveLength(1)
      expect(spans[0]).toMatchObject({
        start: 6,
        end: 19,
        text: 'bravo charlie',
        suggestion: 'redact',
      })
    }
  })

  it('redacts equal ranges independent of contributor order', () => {
    const redact = span('GIVEN_NAME', at('charlie'), 0.5)
    const keep = span('URL', at('charlie'), 0.99)
    for (const spans of [
      reconcile(text, [keep, redact]),
      reconcile(text, [redact, keep]),
    ]) {
      expect(spans).toHaveLength(1)
      expect(spans[0]).toMatchObject({
        start: 12,
        end: 19,
        suggestion: 'redact',
      })
    }
  })

  it('carries a redact detection across a chained overlap in any input order', () => {
    const chained = text.slice(0, 21)
    const contributors = [
      span('URL', { start: 0, end: 10, text: chained.slice(0, 10) }, 0.9),
      span(
        'GIVEN_NAME',
        { start: 8, end: 15, text: chained.slice(8, 15) },
        0.5,
      ),
      span('URL', { start: 13, end: 20, text: chained.slice(13, 20) }, 0.9),
    ]
    const permutations = [
      contributors,
      [...contributors].reverse(),
      [contributors[1]!, contributors[2]!, contributors[0]!],
    ]
    const results = permutations.map((spans) => reconcile(chained, spans))
    for (const result of results) expect(result).toEqual(results[0])
    expect(results[0]).toEqual([
      expect.objectContaining({
        start: 0,
        end: 20,
        text: chained.slice(0, 20),
        suggestion: 'redact',
      }),
    ])
  })

  it('keeps a keep-only union keeping and a redact-only union redacting', () => {
    expect(
      reconcile(text, [
        span('URL', at('bravo charl'), 0.99),
        span('URL', at('charlie'), 0.4),
      ])[0],
    ).toMatchObject({ end: 19, suggestion: 'keep' })
    expect(
      reconcile(text, [
        span('GIVEN_NAME', at('bravo charl'), 0.99),
        span('SURNAME', at('charlie'), 0.4),
      ])[0],
    ).toMatchObject({ end: 19, suggestion: 'redact' })
  })

  it('keeps offsets and text exact across an astral character', () => {
    const value = 'a😀bravo charlie'
    const emojiStart = value.indexOf('😀')
    const bravoStart = value.indexOf('bravo')
    const charlieStart = value.indexOf('charlie')
    const spans = reconcile(value, [
      span(
        'URL',
        {
          start: emojiStart,
          end: bravoStart + 5,
          text: value.slice(emojiStart, bravoStart + 5),
        },
        0.99,
      ),
      span(
        'GIVEN_NAME',
        {
          start: bravoStart,
          end: charlieStart + 7,
          text: value.slice(bravoStart, charlieStart + 7),
        },
        0.5,
      ),
    ])
    expect(spans).toHaveLength(1)
    expect(value.slice(spans[0]!.start, spans[0]!.end)).toBe(spans[0]!.text)
    expect(spans[0]).toMatchObject({
      start: emojiStart,
      end: value.length,
      suggestion: 'redact',
    })
  })

  it('resolves an equal-score tie deterministically and still redacts', () => {
    // Equal score and equal length: only the source tie-break decides which
    // detection names the union. The deterministic source (URL) wins, but the
    // redact-required contributor still owns the disposition.
    const redact = span('GIVEN_NAME', at('charlie'), 0.9)
    const keep = span('URL', at('charlie'), 0.9)
    const forward = reconcile(text, [keep, redact])
    const reverse = reconcile(text, [redact, keep])
    expect(forward).toEqual(reverse)
    expect(forward).toEqual([
      expect.objectContaining({
        start: 12,
        end: 19,
        text: 'charlie',
        category: 'url',
        source: 'rampart_deterministic',
        suggestion: 'redact',
      }),
    ])
  })

  it('is order-independent when contributors have no usable score', () => {
    // `NaN !== NaN`, so an unnormalised comparison would skip the length,
    // source and category tie-breaks and let input order name the union. A
    // non-finite score is normalised to 0.
    const email = span('EMAIL', at('charlie'), Number.NaN)
    const city = span('CITY', at('charlie'), Number.NaN)
    const forward = reconcile(text, [email, city])
    const reverse = reconcile(text, [city, email])
    expect(forward).toEqual(reverse)
    expect(forward).toEqual([
      expect.objectContaining({
        start: 12,
        end: 19,
        text: 'charlie',
        category: 'email',
        source: 'rampart_deterministic',
        suggestion: 'redact',
      }),
    ])
  })

  it('fails loudly for an unknown label and returns nothing for no spans', () => {
    expect(() => reconcile(text, [span('UNKNOWN', at('alpha'), 0.9)])).toThrow(
      'Unrecognised Rampart label',
    )
    expect(reconcile(text, [])).toEqual([])
  })
})
