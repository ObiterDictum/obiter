import { describe, expect, it } from 'bun:test'
import {
  compareQuoteText,
  compareQuoteTextAgainstPrepared,
  normalizeQuoteText,
  prepareQuoteSource,
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

  it.each([
    ['straight', "'"],
    ['left single quotation mark', '\u2018'],
    ['right single quotation mark', '\u2019'],
    ['single low-9 quotation mark', '\u201a'],
    ['single high-reversed-9 quotation mark', '\u201b'],
    ['prime', '\u2032'],
    ['modifier letter apostrophe', '\u02bc'],
    ['fullwidth apostrophe', '\uff07'],
  ])('folds the %s apostrophe to the straight form', (_name, mark) => {
    expect(normalizeQuoteText(`court${mark}s`)).toBe("court's")
  })

  it('does not fold marks that are not apostrophes', () => {
    // The okina is a letter, U+02B9 is a transliteration prime, and the single
    // guillemets are quotation marks. NFC is not NFKC, so nothing compatibility
    // form is folded in either.
    for (const mark of ['\u02bb', '\u02b9', '\u2039', '\u203a']) {
      expect(normalizeQuoteText(`court${mark}s`)).toBe(`court${mark}s`)
    }
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

describe('blank and whitespace quotations', () => {
  it.each([
    ['an empty string', ''],
    ['spaces', '   '],
    ['tabs and newlines', '\t\r\n'],
    ['Unicode whitespace', '\u00a0\u2003\u2028'],
    ['text the folds reduce to nothing', '\u00ad\u00ad'],
  ])('reports %s as an empty quote, never a match', (_name, quote) => {
    expect(outcome(quote, 'the court must consider the point')).toEqual({
      outcome: 'empty_quote',
    })
  })

  it('never gives a blank quotation fragment evidence', () => {
    const result = outcome(' ', 'the  court  must  consider')

    expect(result).toEqual({ outcome: 'empty_quote' })
    expect(result).not.toHaveProperty('fragmentIndexes')
  })

  it('decides emptiness from the quotation, before any source is considered', () => {
    expect(outcome('', '')).toEqual({ outcome: 'empty_quote' })
    expect(outcome('   ')).toEqual({ outcome: 'empty_quote' })
  })
})

describe('prepared sources', () => {
  it('reports the same outcome as preparing once per quotation', () => {
    const fragments = ['the court must', 'consider the point', '']
    const prepared = prepareQuoteSource(fragments)
    if (prepared === null) throw new Error('expected a prepared source')

    for (const quoteText of [
      'the court must consider the point',
      'the points',
      'the court must consider',
      '',
      '\u00ad',
      'a wholly different sentence',
    ]) {
      expect(compareQuoteTextAgainstPrepared(quoteText, prepared)).toEqual(
        compareQuoteText(quoteText, fragments),
      )
    }
  })

  it('reports no prepared source when no fragment carries text', () => {
    expect(prepareQuoteSource(['', ''])).toBeNull()
    expect(compareQuoteText('the point', ['', '   '])).toEqual({
      outcome: 'no_fragments',
    })
  })

  it('counts every fragment it was prepared from, empty ones included', () => {
    expect(prepareQuoteSource(['a', '', 'b'])?.fragmentCount).toBe(3)
  })
})
