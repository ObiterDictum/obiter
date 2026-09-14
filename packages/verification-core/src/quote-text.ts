/**
 * Quote text normalisation and comparison. Pure: it reads no store, calls no
 * provider and holds no identifiers. It compares one quotation's text against
 * already-retrieved source fragment texts and reports whether the quotation
 * appears, differs, or cannot be located. `quote-fidelity.ts` turns the
 * fragment indexes this returns back into V1 evidence.
 *
 * The policy is conservative and lives in `docs/specs/verify/domain-model.md`:
 * only the permitted typographic folds are applied, nothing else is removed,
 * and a difference is only a proven mismatch when a unique anchored alignment
 * establishes the corresponding source passage.
 */

/**
 * The permitted folds, each a legal-document reality rather than a convenience:
 * judgement and Act text is re-encoded between providers, a draft that pasted
 * from PDF or Word carries the typographic forms, and line wrapping, soft
 * hyphens and NBSP all vary without changing a word. The list is deliberately
 * short: case is not folded (capitalisation can be legally meaningful), dashes
 * are not folded (hyphen and en/em dash are not the same mark), and no
 * punctuation, word, negation or number is ever removed.
 *
 * NFC is used rather than NFKC: NFKC also folds compatibility characters such
 * as fullwidth digits and ligatures, which can carry meaning in legal text.
 */
const TYPOGRAPHIC_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201a', "'"],
  ['\u201b', "'"],
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u201e', '"'],
  ['\u201f', '"'],
  ['\u2032', "'"],
  ['\u2033', '"'],
  ['\u2026', '...'],
  ['\u00ad', ''],
]

/** Word tokens used for anchoring. Hoisted: compiling a regex per call on a
 * judgement-sized string is the pattern P16 warns about. `matchAll` clones the
 * pattern, so sharing it across calls does not leak `lastIndex`. */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu

/**
 * The normalised form both sides of a comparison are reduced to. It is
 * deterministic, idempotent, and reversible enough to explain: each fold maps
 * one known variant onto its canonical form, and none of them drops a word,
 * a number, a negation or a punctuation mark stronger than a quote mark.
 */
export function normalizeQuoteText(text: string): string {
  let value = text.normalize('NFC').replace(/\r\n?/g, '\n')
  for (const [from, to] of TYPOGRAPHIC_FOLDS) value = value.replaceAll(from, to)
  // `\s` with the `u` flag folds every Unicode space, including NBSP and the
  // Ogham space, to one ASCII space, so a line wrap is not a difference.
  return value.replace(/\s+/gu, ' ').trim()
}

/** How a proven mismatch differs from the corresponding stored passage. */
export type QuoteDifference =
  'punctuation' | 'reordered' | 'substituted' | 'omitted' | 'inserted'

/**
 * The engine's result. `fragmentIndexes` are indexes into the fragment array
 * it was given, already sorted and deduplicated. A `no_fragments` outcome is
 * distinct from `no_match`: not having source text to compare against is a
 * different failure from not locating the quotation in it.
 */
export type QuoteTextOutcome =
  | { outcome: 'match'; exact: boolean; fragmentIndexes: number[] }
  | {
      outcome: 'mismatch'
      difference: QuoteDifference
      fragmentIndexes: number[]
    }
  | { outcome: 'no_fragments' }
  | { outcome: 'empty_quote' }
  | { outcome: 'no_match' }
  | { outcome: 'ambiguous' }
  | { outcome: 'elided' }

interface FragmentRange {
  start: number
  end: number
  fragmentIndex: number
}

interface WordToken {
  text: string
  start: number
  end: number
}

function wordTokens(text: string): WordToken[] {
  const tokens: WordToken[] = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return tokens
}

function overlappingFragments(
  ranges: readonly FragmentRange[],
  start: number,
  end: number,
): number[] {
  const indexes = ranges
    .filter((range) => range.start < end && range.end > start)
    .map((range) => range.fragmentIndex)
  return [...new Set(indexes)].sort((left, right) => left - right)
}

function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((word, index) => word === right[index])
  )
}

function sameWordMultiset(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false
  const counts = new Map<string, number>()
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1)
  for (const word of right) {
    const count = counts.get(word)
    if (!count) return false
    if (count === 1) counts.delete(word)
    else counts.set(word, count - 1)
  }
  return counts.size === 0
}

function classifyDifference(
  quoteWords: readonly string[],
  spanWords: readonly string[],
  delta: number,
): QuoteDifference {
  if (delta === 1) return 'omitted'
  if (delta === -1) return 'inserted'
  if (sameWords(quoteWords, spanWords)) return 'punctuation'
  if (sameWordMultiset(quoteWords, spanWords)) return 'reordered'
  return 'substituted'
}

/**
 * The one anchored alignment: find a contiguous source span whose first and
 * last word equal the quotation's, allowing the span to carry at most one word
 * more or fewer. Anchoring at both ends with a one-word tolerance is
 * deterministic and bounded, needs no similarity score, and uniquely
 * identifies the corresponding passage or fails. Zero candidates and multiple
 * candidates both mean the passage cannot be established; neither is a
 * mismatch. A larger edit (an elision or a rewritten sentence) also fails here
 * rather than being guessed at.
 */
function findAlignedSpan(
  quoteWords: readonly WordToken[],
  sourceWords: readonly WordToken[],
):
  | { kind: 'aligned'; start: number; end: number; delta: number }
  | { kind: 'none' }
  | { kind: 'ambiguous' } {
  const wordCount = quoteWords.length
  const first = quoteWords[0]?.text
  const last = quoteWords[wordCount - 1]?.text
  if (first === undefined || last === undefined) return { kind: 'none' }

  const candidates: Array<{ start: number; end: number; delta: number }> = []
  for (let index = 0; index < sourceWords.length; index += 1) {
    if (sourceWords[index]?.text !== first) continue
    for (const delta of [0, 1, -1]) {
      const endIndex = index + wordCount + delta - 1
      if (endIndex < index || endIndex >= sourceWords.length) continue
      if (sourceWords[endIndex]?.text !== last) continue
      const start = sourceWords[index]?.start
      const end = sourceWords[endIndex]?.end
      if (start === undefined || end === undefined) continue
      candidates.push({ start, end, delta })
    }
  }

  const [only, ...rest] = candidates
  if (!only) return { kind: 'none' }
  if (rest.length > 0) return { kind: 'ambiguous' }
  return {
    kind: 'aligned',
    start: only.start,
    end: only.end,
    delta: only.delta,
  }
}

/**
 * Compare one quotation against already-retrieved source fragment texts. The
 * exact test runs first, on the raw strings joined by a line break, so an exact
 * quotation is reported as exact rather than merely normalised. Containment
 * then runs on the normalised join, so a quotation spanning adjacent fragments
 * is found. Only if neither holds does the anchored alignment run, and anything
 * it cannot establish returns a non-match rather than a mismatch.
 */
export function compareQuoteText(
  quoteRawText: string,
  fragmentTexts: readonly string[],
): QuoteTextOutcome {
  const rawRanges: FragmentRange[] = []
  const rawParts: string[] = []
  let cursor = 0
  for (const [fragmentIndex, text] of fragmentTexts.entries()) {
    if (!text) continue
    rawRanges.push({ start: cursor, end: cursor + text.length, fragmentIndex })
    rawParts.push(text)
    cursor += text.length + 1
  }
  if (rawRanges.length === 0) return { outcome: 'no_fragments' }

  const rawSource = rawParts.join('\n')
  const exactAt = rawSource.indexOf(quoteRawText)
  if (exactAt >= 0) {
    return {
      outcome: 'match',
      exact: true,
      fragmentIndexes: overlappingFragments(
        rawRanges,
        exactAt,
        exactAt + quoteRawText.length,
      ),
    }
  }

  const normalizedQuote = normalizeQuoteText(quoteRawText)
  if (normalizedQuote.length === 0) return { outcome: 'empty_quote' }

  const normalizedRanges: FragmentRange[] = []
  const normalizedParts: string[] = []
  cursor = 0
  for (const [fragmentIndex, text] of fragmentTexts.entries()) {
    const part = normalizeQuoteText(text)
    if (!part) continue
    normalizedRanges.push({
      start: cursor,
      end: cursor + part.length,
      fragmentIndex,
    })
    normalizedParts.push(part)
    cursor += part.length + 1
  }
  if (normalizedRanges.length === 0) return { outcome: 'no_fragments' }

  const normalizedSource = normalizedParts.join(' ')
  const normalizedAt = normalizedSource.indexOf(normalizedQuote)
  if (normalizedAt >= 0) {
    return {
      outcome: 'match',
      exact: false,
      fragmentIndexes: overlappingFragments(
        normalizedRanges,
        normalizedAt,
        normalizedAt + normalizedQuote.length,
      ),
    }
  }

  // An ellipsis the source does not contain is an elision: what was omitted
  // cannot be known, so the comparison is inconclusive rather than a mismatch.
  if (normalizedQuote.includes('...')) return { outcome: 'elided' }

  const quoteWords = wordTokens(normalizedQuote)
  const aligned = findAlignedSpan(quoteWords, wordTokens(normalizedSource))
  if (aligned.kind === 'none') return { outcome: 'no_match' }
  if (aligned.kind === 'ambiguous') return { outcome: 'ambiguous' }

  const spanText = normalizedSource.slice(aligned.start, aligned.end)
  const spanWords = wordTokens(spanText).map((word) => word.text)
  return {
    outcome: 'mismatch',
    difference: classifyDifference(
      quoteWords.map((word) => word.text),
      spanWords,
      aligned.delta,
    ),
    fragmentIndexes: overlappingFragments(
      normalizedRanges,
      aligned.start,
      aligned.end,
    ),
  }
}
