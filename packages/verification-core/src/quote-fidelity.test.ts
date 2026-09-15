import { describe, expect, it } from 'vitest'
import {
  createVerificationFindingId,
  decideQuoteFidelity,
  QuoteSourceMismatchError,
  verificationFindingSchema,
  type NormalizedCitation,
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
 * The V4 decision: a quotation and a store read onto a V1 `quote_fidelity`
 * finding. The cases assert the honest mapping, the evidence rules, and the
 * guards that stop a quote being verified against a source it does not belong
 * to.
 */

describe('quote fidelity decisions', () => {
  it('clears an exact quotation with the fragment that shows it', () => {
    const finding = find('the court must consider the point', caseLaw, {
      outcome: 'ready',
      fragments: [
        paragraph(1, 'The court began.'),
        paragraph(2, 'the court must consider the point'),
      ],
    })

    expect(finding.type).toBe('quote_fidelity')
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.severity).toBe('low')
    expect(finding.confidence).toBe('high')
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'uksc-2099-1',
        ordinal: 2,
        paragraphNumber: 2,
      },
    ])
    expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
  })

  it('lowers confidence for a match only a permitted typographic fold produced', () => {
    const finding = find("the court's view", caseLaw, {
      outcome: 'ready',
      fragments: [paragraph(1, 'It is the court\u2019s view that')],
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.confidence).toBe('medium')
  })

  it('flags a proven material mismatch with the fragment that shows it', () => {
    const finding = find('the defendant was liable', caseLaw, {
      outcome: 'ready',
      fragments: [paragraph(7, 'the defendant was not liable')],
    })

    expect(finding.status).toEqual({ state: 'flagged' })
    expect(finding.severity).toBe('high')
    expect(finding.confidence).toBe('high')
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'uksc-2099-1',
        ordinal: 7,
        paragraphNumber: 7,
      },
    ])
  })

  it('clears a legislation quotation on the cited provision fragment', () => {
    const finding = find('must not act incompatibly', legislation, {
      outcome: 'ready',
      fragments: [provision],
      resolvedProvision: resolvedSection40,
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2010/15',
        labelPath: 'section/40',
      },
    ])
  })

  it('keys the finding on the quotation span, not the citation span', () => {
    const quote = span('a quoted passage')
    const finding = decideQuoteFidelity({
      subject,
      quote,
      normalizedCitation: caseLaw,
      source: {
        outcome: 'ready',
        fragments: [paragraph(1, 'a quoted passage')],
      },
    })

    expect(finding.id).toBe(
      createVerificationFindingId({
        subject,
        type: 'quote_fidelity',
        location: quote.location,
      }),
    )
    expect(finding.id).not.toContain('a quoted passage')
    expect(finding.citation.rawText).toBe('a quoted passage')
  })
})

describe('quote fidelity failure outcomes', () => {
  it.each<
    [string, NormalizedCitation, 'citation_unresolved' | 'citation_ambiguous']
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
  ])(
    'requires review for %s without touching a source',
    (_name, citation, reason) => {
      const finding = find('any quotation', citation, {
        outcome: 'not_checked',
      })

      expect(finding.status).toEqual({ state: 'review_required', reason })
      expect(finding.evidence).toEqual([])
    },
  )

  it('reports not checked when the citation never ran', () => {
    const finding = find(
      'any quotation',
      { kind: 'not_checked' },
      {
        outcome: 'not_checked',
      },
    )

    expect(finding.status).toEqual({ state: 'not_checked' })
    expect(finding.severity).toBeNull()
    expect(finding.confidence).toBeNull()
    expect(finding.evidence).toEqual([])
  })

  const unavailableSources: QuoteSourceOutcome[] = [
    { outcome: 'unavailable', reason: 'source_withdrawn' },
    { outcome: 'unavailable', reason: 'missing_provision' },
    { outcome: 'unavailable', reason: 'no_addressable_provision' },
    { outcome: 'unavailable', reason: 'source_not_held' },
    { outcome: 'unavailable', reason: 'source_too_large' },
    { outcome: 'unavailable', reason: 'source_malformed' },
    { outcome: 'unavailable', reason: 'source_unreadable' },
  ]
  it.each(unavailableSources)(
    'never reports a mismatch for an unavailable source %j',
    (source) => {
      const finding = find('a quotation', caseLaw, source)
      expect(finding.status.state).toBe('review_required')
      expect(finding.status).not.toEqual({ state: 'flagged' })
    },
  )

  it('reports evidence unavailable rather than a pass when no fragment exists', () => {
    const finding = find('a quotation', caseLaw, {
      outcome: 'ready',
      fragments: [],
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
    expect(finding.evidence).toEqual([])
  })

  it('reports inconclusive rather than a mismatch when the passage is not located', () => {
    const finding = find('a wholly different sentence', caseLaw, {
      outcome: 'ready',
      fragments: [paragraph(1, 'the court must consider the point')],
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('a resolved citation with no source read is a programmer error', () => {
    expect(() =>
      find('a quotation', caseLaw, { outcome: 'not_checked' }),
    ).toThrow(QuoteSourceMismatchError)
  })
})

describe('quote fidelity evidence guards', () => {
  it('rejects a fragment from another judgment', () => {
    expect(() =>
      find('a quotation', caseLaw, {
        outcome: 'ready',
        fragments: [
          {
            sourceType: 'judgment',
            sourceId: 'uksc-other',
            ordinal: 1,
            paragraphNumber: 1,
            text: 'a quotation',
          },
        ],
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('rejects legislation evidence on a case-law citation and vice versa', () => {
    expect(() =>
      find('a quotation', caseLaw, {
        outcome: 'ready',
        fragments: [provision],
      }),
    ).toThrow(QuoteSourceMismatchError)

    expect(() =>
      find('a quotation', legislation, {
        outcome: 'ready',
        fragments: [paragraph(1, 'a quotation')],
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('rejects more than one provision fragment for a provision citation', () => {
    expect(() =>
      find('a quotation', legislation, {
        outcome: 'ready',
        fragments: [provision, { ...provision, labelPath: 'section/41' }],
      }),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('rejects a whole-Act citation that carries a provision fragment', () => {
    expect(() =>
      find(
        'a quotation',
        { ...legislation, labelPath: null },
        {
          outcome: 'ready',
          fragments: [provision],
        },
      ),
    ).toThrow(QuoteSourceMismatchError)
  })

  it('deduplicates repeated fragment evidence deterministically', () => {
    const finding = find('alpha beta', caseLaw, {
      outcome: 'ready',
      fragments: [
        paragraph(1, 'alpha'),
        paragraph(2, 'beta'),
        paragraph(3, 'alpha beta appears here'),
      ],
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toHaveLength(1)
    expect(finding.evidence[0]).toMatchObject({ ordinal: 3 })
  })
})
