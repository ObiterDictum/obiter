import { describe, expect, it } from 'vitest'
import {
  decideQuoteFidelity,
  prepareQuoteSource,
  QuoteSourceMismatchError,
  QuoteSpanInvalidError,
  quoteSpanViolation,
  verificationFindingSchema,
  type CitationInput,
  type NormalizedCitation,
  type QuoteFragment,
  type QuoteSourceOutcome,
} from './index'
import {
  caseLaw,
  find,
  legislation,
  paragraph,
  provision,
  resolvedSection40,
  span,
  subject,
} from './quote-fidelity.test-support'

/**
 * The V4 span contract and source-integrity guards: a blank or mis-sliced
 * quotation is a named refusal, and a ready source that does not describe the
 * cited authority is a programmer error rather than a finding.
 */

describe('quotation span contract', () => {
  it.each<[string, string, NormalizedCitation, QuoteSourceOutcome]>([
    [
      'a blank quotation on an unresolved citation',
      ' ',
      { kind: 'unresolved', reason: 'no_canonical_match' },
      { outcome: 'not_checked' },
    ],
    [
      'a blank quotation on an unrun citation',
      '\t\n',
      { kind: 'not_checked' },
      { outcome: 'not_checked' },
    ],
    [
      'a blank quotation on a resolved citation',
      '',
      caseLaw,
      {
        outcome: 'ready',
        fragments: [paragraph(1, 'the court must consider the point')],
      },
    ],
  ])(
    'refuses %s with a named error, not a schema error',
    (_name, text, citation, source) => {
      expect(() => find(text, citation, source)).toThrow(QuoteSpanInvalidError)
      expect(() => find(text, citation, source)).toThrow(
        /blank quotation has no finding/,
      )
    },
  )

  it('refuses a quotation that is not the slice its location names', () => {
    const quote: CitationInput = {
      rawText: 'a quotation',
      location: { paragraphId: 'p-4', start: 0, end: 5 },
    }

    expect(() =>
      decideQuoteFidelity({
        subject,
        quote,
        normalizedCitation: caseLaw,
        source: {
          outcome: 'ready',
          fragments: [paragraph(1, 'a quotation')],
        },
      }),
    ).toThrow(QuoteSpanInvalidError)
  })

  it('names the violation without needing a source', () => {
    expect(quoteSpanViolation(span('  '))).toBe('blank')
    expect(quoteSpanViolation(span('\u00ad'))).toBeNull()
    expect(
      quoteSpanViolation({
        rawText: 'abc',
        location: { paragraphId: 'p-4', start: 0, end: 2 },
      }),
    ).toBe('length_mismatch')
    expect(quoteSpanViolation(span('abc'))).toBeNull()
  })

  it('reports a quotation the folds reduce to nothing as review required', () => {
    const finding = find('\u00ad\u00ad', caseLaw, {
      outcome: 'ready',
      fragments: [paragraph(1, 'the court must consider the point')],
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.evidence).toEqual([])
    expect(finding.confidence).toBe('low')
    expect(finding.explanation).toContain('no comparable text')
    expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
  })

  it('never clears a quotation that carries no comparable word', () => {
    for (const text of ['\u00ad', '\u00ad\u00ad\u00ad']) {
      const finding = find(text, caseLaw, {
        outcome: 'ready',
        fragments: [paragraph(1, text)],
      })

      expect(finding.status.state).not.toBe('clear')
      expect(finding.status.state).not.toBe('flagged')
      expect(finding.evidence).toEqual([])
    }
  })

  it.each<
    [
      string,
      NormalizedCitation,
      'citation_unresolved' | 'citation_ambiguous' | null,
    ]
  >([
    [
      'an unresolved citation',
      { kind: 'unresolved', reason: 'no_canonical_match' },
      'citation_unresolved',
    ],
    [
      'an ambiguous citation',
      { kind: 'unresolved', reason: 'ambiguous' },
      'citation_ambiguous',
    ],
    ['an unrun citation', { kind: 'not_checked' }, null],
  ])(
    'keeps a fold-empty quotation honest against %s',
    (_name, citation, reason) => {
      const finding = find('\u00ad', citation, { outcome: 'not_checked' })

      expect(finding.status.state).not.toBe('clear')
      expect(finding.evidence).toEqual([])
      if (reason === null) {
        expect(finding.status).toEqual({ state: 'not_checked' })
      } else {
        expect(finding.status).toEqual({ state: 'review_required', reason })
      }
    },
  )
})

describe('legislation resolved-provision guard', () => {
  const alias = { ...legislation, labelPath: 'schedule/1/paragraph/4' }
  const scheduleProvision: QuoteFragment = {
    sourceType: 'legislation_provision',
    sourceId: 'ukpga/2010/15',
    labelPath: 'schedule/paragraph/4',
    text: 'The single schedule provision text.',
  }
  const resolvedSchedule = {
    documentIdentity: 'ukpga/2010/15',
    labelPath: 'schedule/paragraph/4',
  }

  it('accepts the stored canonical path the single-schedule alias resolves to', () => {
    const finding = find('The single schedule provision text.', alias, {
      outcome: 'ready',
      fragments: [scheduleProvision],
      resolvedProvision: resolvedSchedule,
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2010/15',
        labelPath: 'schedule/paragraph/4',
      },
    ])
  })

  it('refuses a fragment from another provision of the same Act', () => {
    expect(() =>
      find('A different provision entirely.', legislation, {
        outcome: 'ready',
        fragments: [
          {
            sourceType: 'legislation_provision',
            sourceId: 'ukpga/2010/15',
            labelPath: 'section/41',
            text: 'A different provision entirely.',
          },
        ],
        resolvedProvision: resolvedSection40,
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('refuses a resolved provision of another Act', () => {
    expect(() =>
      find('must not act incompatibly', legislation, {
        outcome: 'ready',
        fragments: [provision],
        resolvedProvision: {
          documentIdentity: 'ukpga/2011/1',
          labelPath: 'section/40',
        },
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('refuses a legislation comparison that carries no resolved identity', () => {
    expect(() =>
      find('must not act incompatibly', legislation, {
        outcome: 'ready',
        fragments: [provision],
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('refuses a prepared source that does not describe its fragments', () => {
    expect(() =>
      find('a quotation', caseLaw, {
        outcome: 'ready',
        fragments: [paragraph(1, 'a quotation'), paragraph(2, 'and more')],
        preparedSource: prepareQuoteSource(['a quotation']) ?? undefined,
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('compares against a prepared source the boundary supplied', () => {
    const prepared = prepareQuoteSource([
      'The court began.',
      'the court must consider the point',
    ])
    if (prepared === null) throw new Error('expected a prepared source')

    const finding = find('the court must consider the point', caseLaw, {
      outcome: 'ready',
      fragments: [
        paragraph(1, 'The court began.'),
        paragraph(2, 'the court must consider the point'),
      ],
      preparedSource: prepared,
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence[0]).toMatchObject({ ordinal: 2 })
  })
})
