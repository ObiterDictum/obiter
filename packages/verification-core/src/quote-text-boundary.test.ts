import { describe, expect, it } from 'vitest'
import { compareQuoteText, type QuoteTextOutcome } from './index'

/**
 * Boundary-qualified containment and mismatch classification: a clipped
 * quotation must not clear, and a proven wording difference must name its
 * kind rather than pass as a match.
 */

function outcome(quote: string, ...fragments: string[]): QuoteTextOutcome {
  return compareQuoteText(quote, fragments)
}

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

describe('word-boundary containment', () => {
  it('does not clear a quotation clipped at its first word', () => {
    expect(
      outcome('he court must consider', 'the court must consider the point'),
    ).toEqual({ outcome: 'no_match' })
  })

  it('does not clear a quotation clipped at its last word', () => {
    expect(outcome('the point', 'the points were argued')).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('the cour', 'the court must consider')).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('court must conside', 'the court must consider')).toEqual({
      outcome: 'no_match',
    })
  })

  it('does not clear a quotation that is a fragment of one word', () => {
    expect(outcome('act', 'exact')).toEqual({ outcome: 'no_match' })
    expect(outcome('oint', 'the point')).toEqual({ outcome: 'no_match' })
  })

  it('keeps numbers and statutory references whole', () => {
    expect(outcome('40', 'section 405 requires notice')).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('section 40', 'section 405 requires notice')).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('section 40', 'section 40 requires notice')).toMatchObject({
      outcome: 'match',
    })
    expect(outcome('s 40', 's 405')).toEqual({ outcome: 'no_match' })
  })

  it('keeps combining marks inside the word they modify', () => {
    expect(outcome('cole', 'école')).toEqual({ outcome: 'no_match' })
    expect(outcome('école', 'the e\u0301cole gate')).toMatchObject({
      outcome: 'match',
      exact: false,
    })
  })

  it('treats an apostrophe inside a word as part of that word', () => {
    // A quotation that stops inside a contraction or possessive is a
    // partial-word match, so it cannot clear.
    expect(outcome('the court', "the court's view")).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('courts', "the courts' view")).toEqual({
      outcome: 'no_match',
    })
    expect(outcome('don', "they don't agree")).toEqual({
      outcome: 'no_match',
    })
  })

  it('clears a contraction or possessive quoted whole, in any typography', () => {
    expect(outcome("the court's view", 'the court\u2019s view')).toEqual({
      outcome: 'match',
      exact: false,
      fragmentIndexes: [0],
    })
    expect(outcome('the court\u02bcs view', "the court's view")).toEqual({
      outcome: 'match',
      exact: false,
      fragmentIndexes: [0],
    })
  })

  it('keeps a quotation that begins or ends with punctuation', () => {
    expect(
      outcome(
        '"the court must consider"',
        'He said "the court must consider" again.',
      ),
    ).toMatchObject({ outcome: 'match', exact: true })
    expect(
      outcome('the court must consider.', 'the court must consider. It did.'),
    ).toMatchObject({ outcome: 'match' })
    expect(
      outcome(
        '(the court must consider)',
        'He said (the court must consider) it.',
      ),
    ).toMatchObject({ outcome: 'match' })
    expect(
      outcome(
        'the court must consider',
        'He said (the court must consider) it.',
      ),
    ).toMatchObject({ outcome: 'match' })
    expect(
      outcome(
        'the court must consider',
        'He said "the court must consider" it.',
      ),
    ).toMatchObject({ outcome: 'match' })
  })

  it('falls to review rather than clear inside single quotation marks', () => {
    // An apostrophe mark touching a word joins that word, and the comparison
    // does not guess whether it opens a quotation. Inconclusive is the safe
    // direction, and double quotation marks are unaffected above.
    expect(
      outcome(
        'the court must consider',
        "He said 'the court must consider' it.",
      ),
    ).toEqual({ outcome: 'no_match' })
  })

  it('prefers a whole-word occurrence to an earlier infix', () => {
    expect(
      outcome('point', 'the points were argued; the point stands'),
    ).toEqual({ outcome: 'match', exact: true, fragmentIndexes: [0] })
    expect(outcome('act', 'the exact words: an act of Parliament')).toEqual({
      outcome: 'match',
      exact: true,
      fragmentIndexes: [0],
    })
  })

  it('names the first valid occurrence when a quotation repeats', () => {
    expect(
      outcome('the point', 'the points were argued', 'the point stands'),
    ).toEqual({ outcome: 'match', exact: true, fragmentIndexes: [1] })
  })

  it('matches normalised typography only at a valid boundary', () => {
    expect(
      outcome(
        'the\u00a0court must consider',
        'the court must consider the point',
      ),
    ).toEqual({ outcome: 'match', exact: false, fragmentIndexes: [0] })
    expect(outcome('the\u00a0cour', 'the court must consider')).toEqual({
      outcome: 'no_match',
    })
  })

  it('handles punctuation-only quotations', () => {
    expect(outcome('...', 'and so on ... and so forth')).toMatchObject({
      outcome: 'match',
    })
    expect(outcome('...', 'and so on and so forth')).toEqual({
      outcome: 'elided',
    })
    expect(outcome('—', 'the court must consider')).toEqual({
      outcome: 'no_match',
    })
  })

  it('handles one-, two- and three-word quotations', () => {
    const source = 'the court must consider the point'

    expect(outcome('consider', source)).toMatchObject({ outcome: 'match' })
    expect(outcome('onsider', source)).toEqual({ outcome: 'no_match' })
    expect(outcome('must consider', source)).toMatchObject({ outcome: 'match' })
    expect(outcome('must conside', source)).toEqual({ outcome: 'no_match' })
    expect(outcome('court must consider', source)).toMatchObject({
      outcome: 'match',
    })
    expect(outcome('court must conside', source)).toEqual({
      outcome: 'no_match',
    })
  })
})

describe('boundary invariant', () => {
  const source =
    "The court must consider the point (and the court's view of the points) under section 40."

  /** An independent restatement of the boundary contract, so the sweep below
   * checks the engine against the rule rather than against itself. A quotation
   * edge that is punctuation or whitespace has nothing to glue to, so only a
   * word-character edge is checked against its neighbour. */
  function hasCleanOccurrence(needle: string): boolean {
    const wordish = (character: string) =>
      character.length > 0 &&
      (/[\p{L}\p{N}\p{M}]/u.test(character) || character === "'")
    const first = needle.slice(0, 1)
    const last = needle.slice(-1)
    for (
      let at = source.indexOf(needle);
      at >= 0;
      at = source.indexOf(needle, at + 1)
    ) {
      const leftOk = !wordish(first) || !wordish(source.slice(at - 1, at))
      const rightOk =
        !wordish(last) ||
        !wordish(source.slice(at + needle.length, at + needle.length + 1))
      if (leftOk && rightOk) return true
    }
    return false
  }

  it('never reports a match without a boundary-valid occurrence', () => {
    for (let start = 0; start < source.length; start += 1) {
      for (let end = start + 1; end <= source.length; end += 1) {
        const quoteText = source.slice(start, end)
        const result = outcome(quoteText, source)
        if (result.outcome !== 'match') continue

        expect(hasCleanOccurrence(quoteText)).toBe(true)
        expect(result.fragmentIndexes.length).toBeGreaterThan(0)
      }
    }
  })

  it('never matches a strict infix of a word', () => {
    for (const word of source.split(/[^\p{L}\p{N}']+/u)) {
      for (let start = 0; start < word.length; start += 1) {
        for (let end = word.length; end > start; end -= 1) {
          const quoteText = word.slice(start, end)
          if (quoteText === word) continue
          expect(outcome(quoteText, word).outcome).not.toBe('match')
        }
      }
    }
  })
})
