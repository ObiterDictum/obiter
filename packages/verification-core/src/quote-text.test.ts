import { describe, expect, it } from 'vitest'
import {
  compareQuoteText,
  normalizeQuoteText,
  type QuoteTextOutcome,
} from './index'

/**
 * The comparison engine and its normalisation policy. These are behavioural:
 * each case states what a quotation does to a stored fragment and what the
 * check is allowed to conclude.
 */

function outcome(quote: string, ...fragments: string[]): QuoteTextOutcome {
  return compareQuoteText(quote, fragments)
}

describe('quote text normalisation', () => {
  it('collapses line wrapping, repeated whitespace and non-breaking spaces', () => {
    expect(normalizeQuoteText('the  court\nmust\r\n\tconsider')).toBe(
      'the court must consider',
    )
    expect(normalizeQuoteText('the\u00a0court\u2003must')).toBe(
      'the court must',
    )
  })

  it('folds curly quotation marks and apostrophes to their straight forms', () => {
    expect(normalizeQuoteText('\u201cthe court\u2019s view\u201d')).toBe(
      '"the court\'s view"',
    )
  })

  it('folds the ellipsis character to three periods and removes soft hyphens', () => {
    expect(normalizeQuoteText('so on\u2026 and so on')).toBe(
      'so on... and so on',
    )
    expect(normalizeQuoteText('hyphe\u00adn')).toBe('hyphen')
  })

  it('normalises Unicode composition but not compatibility forms', () => {
    expect(normalizeQuoteText('e\u0301')).toBe('é')
    expect(normalizeQuoteText('４２')).toBe('４２')
  })

  it('does not fold case, dashes, punctuation or numbers', () => {
    expect(normalizeQuoteText('The Court')).toBe('The Court')
    expect(normalizeQuoteText('a-b')).toBe('a-b')
    expect(normalizeQuoteText('a–b')).toBe('a–b')
    expect(normalizeQuoteText('shall not, 40')).toBe('shall not, 40')
  })
})

describe('exact and normalised matches', () => {
  it('reports an exact quotation inside a fragment as exact', () => {
    const result = outcome(
      'the court must consider',
      'The court began. the court must consider the point. It did.',
    )

    expect(result).toEqual({
      outcome: 'match',
      exact: true,
      fragmentIndexes: [0],
    })
  })

  it('reports a match that only a permitted fold produced as normalised', () => {
    const result = outcome(
      'the court\u2019s view',
      'It is the court\u2019s view that',
    )

    expect(result).toEqual({
      outcome: 'match',
      exact: true,
      fragmentIndexes: [0],
    })

    const folded = outcome('the court\u2019s view', "the court's view applies")
    expect(folded).toEqual({
      outcome: 'match',
      exact: false,
      fragmentIndexes: [0],
    })
  })

  it('matches a full-paragraph quote and a substring quote', () => {
    expect(
      outcome(
        'The court must consider the point.',
        'The court must consider the point.',
      ),
    ).toMatchObject({ outcome: 'match' })
    expect(
      outcome(
        'must consider',
        'The court must consider the point. It did so carefully.',
      ),
    ).toMatchObject({ outcome: 'match', fragmentIndexes: [0] })
  })

  it('matches across adjacent fragments and names both', () => {
    const result = outcome(
      'the court must consider the point',
      'the court must',
      'consider the point',
    )

    expect(result).toMatchObject({
      outcome: 'match',
      fragmentIndexes: [0, 1],
    })
  })

  it('does not match a quotation spanning non-adjacent fragments', () => {
    const result = outcome(
      'alpha the court must consider the point omega',
      'alpha the court must',
      'an unrelated paragraph',
      'consider the point omega',
    )

    expect(result.outcome).not.toBe('match')
  })

  it('takes the first occurrence when a quote repeats', () => {
    expect(outcome('the point', 'the point first', 'the point second')).toEqual(
      { outcome: 'match', exact: true, fragmentIndexes: [0] },
    )
  })
})

describe('proven mismatches', () => {
  it('flags a substituted word', () => {
    expect(
      outcome(
        'the court must consider the point',
        'the court must reject the point',
      ),
    ).toMatchObject({ outcome: 'mismatch', difference: 'substituted' })
  })

  it('flags a missing word and a removed negation', () => {
    expect(
      outcome('the court must the point', 'the court must consider the point'),
    ).toMatchObject({ outcome: 'mismatch', difference: 'omitted' })

    expect(
      outcome('the defendant was liable', 'the defendant was not liable'),
    ).toMatchObject({ outcome: 'mismatch', difference: 'omitted' })
  })

  it('flags an inserted word', () => {
    expect(
      outcome(
        'the court must always consider the point',
        'the court must consider the point',
      ),
    ).toMatchObject({ outcome: 'mismatch', difference: 'inserted' })
  })

  it('flags a number difference', () => {
    expect(outcome('within 40 days', 'within 42 days')).toMatchObject({
      outcome: 'mismatch',
      difference: 'substituted',
    })
  })

  it('flags a punctuation difference when the words are identical', () => {
    expect(
      outcome(
        'the court must consider, the point',
        'the court must consider the point',
      ),
    ).toMatchObject({ outcome: 'mismatch', difference: 'punctuation' })
  })

  it('flags reordered words as a material difference', () => {
    expect(
      outcome('alpha beta gamma delta', 'alpha gamma beta delta'),
    ).toMatchObject({ outcome: 'mismatch', difference: 'reordered' })
  })

  it('names every fragment an aligned mismatch spans', () => {
    const result = outcome(
      'the court must consider the point',
      'the court must',
      'reject the point',
    )

    expect(result).toMatchObject({
      outcome: 'mismatch',
      fragmentIndexes: [0, 1],
    })
  })
})

describe('inconclusive comparisons', () => {
  it('reports no fragments when there is nothing to compare against', () => {
    expect(outcome('the point', '', '   ')).toEqual({ outcome: 'no_fragments' })
  })

  it('reports an empty quote when it reduces to no comparable text', () => {
    expect(outcome('\u00ad\u00ad', 'the point')).toEqual({
      outcome: 'empty_quote',
    })
  })

  it('does not flag a passage it cannot locate', () => {
    expect(
      outcome(
        'a wholly different sentence',
        'the court must consider the point',
      ),
    ).toEqual({ outcome: 'no_match' })
  })

  it('does not flag when more than one passage could correspond', () => {
    const result = outcome(
      'the court must consider the point',
      'the court must reject the point and the court must ignore the point',
    )

    expect(result).toEqual({ outcome: 'ambiguous' })
  })

  it('treats an unmatched ellipsis as an elision, not a mismatch', () => {
    expect(
      outcome(
        'the court must ... consider the point',
        'the court must very carefully consider the point',
      ),
    ).toEqual({ outcome: 'elided' })
  })

  it('does not flag a large rewrite as a small edit', () => {
    expect(
      outcome(
        'the court must consider the point',
        'the court should always take great care to weigh the point',
      ),
    ).toEqual({ outcome: 'no_match' })
  })
})
