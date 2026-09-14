/**
 * Quote text comparison over normalised text. Pure: it reads no store, calls no
 * provider and holds no identifiers. It compares one quotation's text against
 * already-retrieved source fragment texts and reports whether the quotation
 * appears, differs, or cannot be located. `quote-fidelity.ts` turns the
 * fragment indexes this returns back into V1 evidence, and
 * `quote-normalization.ts` owns the folds and the apostrophe set this file
 * reads.
 *
 * The policy is conservative and lives in
 * `docs/specs/verify/quote-fidelity.md`: only the permitted typographic folds
 * are applied, nothing else is removed, a quotation only matches at a word
 * boundary, and a difference is only a proven mismatch when a unique anchored
 * alignment establishes the corresponding source passage.
 */

import { APOSTROPHE_MARKS, normalizeQuoteText } from './quote-normalization'

/** The characters a word is made of: Unicode letters, numbers and combining
 * marks. A combining mark survives NFC when its pair has no composed form, and
 * it belongs to the word it modifies rather than starting a new one. */
const WORD_CHARACTER = /^[\p{L}\p{N}\p{M}]$/u

/** Apostrophe marks by the definition `quote-normalization.ts` owns. */
const APOSTROPHE = new Set(APOSTROPHE_MARKS)

/**
 * Word tokens used for anchoring and for the word-boundary test. The pattern is
 * built from the one apostrophe set above so the two cannot drift; every member
 * is a literal character with no meaning inside a character class. Hoisted:
 * compiling a regex per call on a judgement-sized string is the pattern P16
 * warns about. `matchAll` clones the pattern, so sharing it across calls does
 * not leak `lastIndex`.
 *
 * An apostrophe mark that touches a word character is part of the token, so
 * `court's`, `courts'` and `don't` are each one word. That is what stops a
 * quotation ending inside a contraction from matching part of a word.
 */
const WORD_PATTERN = new RegExp(
  `${apostropheClass()}*[\\p{L}\\p{N}\\p{M}]+` +
    `(?:${apostropheClass()}+[\\p{L}\\p{N}\\p{M}]+)*` +
    `${apostropheClass()}*`,
  'gu',
)

function apostropheClass(): string {
  return `[${APOSTROPHE_MARKS.join('')}]`
}

/** How a proven mismatch differs from the corresponding stored passage. */
export type QuoteDifference =
  'punctuation' | 'reordered' | 'substituted' | 'omitted' | 'inserted'

/**
 * The engine's result. `fragmentIndexes` are indexes into the fragment array
 * it was given, already sorted and deduplicated. A `no_fragments` outcome is
 * distinct from `no_match`: not having source text to compare against is a
 * different failure from not locating the quotation in it. `empty_quote` is
 * decided from the quotation alone, before any source is consulted, so a
 * quotation that reduces to no comparable text can be neither a match nor a
 * mismatch and never carries fragment evidence.
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

/** A contiguous span of the joined source text that one fragment occupies. */
export interface QuoteFragmentRange {
  start: number
  end: number
  fragmentIndex: number
}

/** One word of the normalised source, with where it sits in that text. */
export interface QuoteWordToken {
  text: string
  start: number
  end: number
}

/**
 * One authority's source text, prepared once and reused by every quotation
 * that cites it. It is derived only from the fragment texts it was given, so it
 * cannot carry one source's text into another source's comparison; the
 * caller checks `fragmentCount` against the fragments it is used with. It
 * carries the joined text, the per-fragment ranges and the word tokens so that
 * citing one judgment from a document of many quotations pays the
 * normalisation and tokenisation once rather than per quotation.
 */
export interface PreparedQuoteSource {
  /** The raw fragment texts, joined by a line break. */
  readonly rawText: string
  /** The normalised fragment texts, joined by a space. */
  readonly normalizedText: string
  readonly normalizedWords: readonly QuoteWordToken[]
  readonly rawRanges: readonly QuoteFragmentRange[]
  readonly normalizedRanges: readonly QuoteFragmentRange[]
  /** The number of fragment texts this was prepared from, empty ones included. */
  readonly fragmentCount: number
}

function wordTokens(text: string): QuoteWordToken[] {
  const tokens: QuoteWordToken[] = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return tokens
}

/** The character ending at `index`, as one code point, or null at either end. */
function characterBefore(text: string, index: number): string | null {
  if (index <= 0 || index > text.length) return null
  const trailing = text.charCodeAt(index - 1)
  if (trailing >= 0xdc00 && trailing <= 0xdfff && index >= 2) {
    const leading = text.charCodeAt(index - 2)
    if (leading >= 0xd800 && leading <= 0xdbff) {
      return text.slice(index - 2, index)
    }
  }
  return text.slice(index - 1, index)
}

/** The character starting at `index`, as one code point, or null at either end. */
function characterAt(text: string, index: number): string | null {
  if (index < 0 || index >= text.length) return null
  const point = text.codePointAt(index)
  return point === undefined ? null : String.fromCodePoint(point)
}

function isWordCharacter(character: string | null): boolean {
  return character !== null && WORD_CHARACTER.test(character)
}

function isApostrophe(character: string | null): boolean {
  return character !== null && APOSTROPHE.has(character)
}

/**
 * Whether the cut at `index` falls inside one word run. A word run is a run of
 * letters, numbers and combining marks that may carry an apostrophe mark
 * wherever it touches a word character: `court's`, `courts'` and `don't` are
 * each one run. A quotation that begins or ends inside one is a partial-word
 * match, which is the clipped-extraction error this check exists to catch.
 *
 * The model is deliberately unchanged by the apostrophe's typography: the fold
 * list and this test read the same set, so `court's`, `court’s` and
 * `courtʼs` bound identically before and after normalisation. A mark that
 * touches no word character joins nothing, and `"`, `(` and `)` are never
 * apostrophes, so a quotation taken from inside `"quotation marks"` or from
 * inside `(parentheses)` still clears.
 */
function isInsideWordRun(text: string, index: number): boolean {
  const left = characterBefore(text, index)
  const right = characterAt(text, index)
  if (isWordCharacter(left) && isWordCharacter(right)) return true
  if (left !== null && isApostrophe(left) && isWordCharacter(right)) {
    return isWordCharacter(characterBefore(text, index - left.length))
  }
  if (isWordCharacter(left) && isApostrophe(right)) return true
  return false
}

/**
 * The first occurrence of `needle` in `text` at or after `from` that begins and
 * ends at a word boundary. An earlier occurrence that is an infix of a word is
 * skipped in favour of a later whole-word occurrence, so a clipped quotation
 * never clears merely because some longer word contains its characters. The
 * scan stays linear: a position inside a word run is rejected by the constant
 * time boundary test before the needle comparison runs.
 */
function findBoundaryValidOccurrence(
  text: string,
  needle: string,
  from: number,
): number {
  if (needle.length === 0) return -1
  const first = characterAt(needle, 0)
  const last = text.length - needle.length
  for (let at = Math.max(from, 0); at <= last; at += 1) {
    if (isInsideWordRun(text, at)) continue
    if (characterAt(text, at) !== first) continue
    if (!text.startsWith(needle, at)) continue
    if (isInsideWordRun(text, at + needle.length)) continue
    return at
  }
  return -1
}

function overlappingFragments(
  ranges: readonly QuoteFragmentRange[],
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
  quoteWords: readonly QuoteWordToken[],
  sourceWords: readonly QuoteWordToken[],
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
 * Prepare one authority's fragment texts for comparison. Returns null when no
 * fragment carries any text, which is the `no_fragments` outcome.
 */
export function prepareQuoteSource(
  fragmentTexts: readonly string[],
): PreparedQuoteSource | null {
  const rawRanges: QuoteFragmentRange[] = []
  const rawParts: string[] = []
  let cursor = 0
  for (const [fragmentIndex, text] of fragmentTexts.entries()) {
    if (!text) continue
    rawRanges.push({ start: cursor, end: cursor + text.length, fragmentIndex })
    rawParts.push(text)
    cursor += text.length + 1
  }
  if (rawRanges.length === 0) return null

  const normalizedRanges: QuoteFragmentRange[] = []
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

  const normalizedText = normalizedParts.join(' ')
  return {
    rawText: rawParts.join('\n'),
    normalizedText,
    normalizedWords: wordTokens(normalizedText),
    rawRanges,
    normalizedRanges,
    fragmentCount: fragmentTexts.length,
  }
}

/**
 * Compare one quotation against already-prepared source text. The exact test
 * runs first, on the raw strings joined by a line break, so an exact quotation
 * is reported as exact rather than merely normalised. Containment then runs on
 * the normalised join, so a quotation spanning adjacent fragments is found.
 * Both are word-boundary qualified. Only if neither holds does the anchored
 * alignment run, and anything it cannot establish returns a non-match rather
 * than a mismatch.
 */
export function compareQuoteTextAgainstPrepared(
  quoteRawText: string,
  source: PreparedQuoteSource,
): QuoteTextOutcome {
  // Whether a quotation carries comparable text is a property of the quotation
  // alone, so it is decided before any source is consulted. Without this the
  // exact test below reports a blank or whitespace-only quotation as an exact
  // match with no fragment evidence.
  const normalizedQuote = normalizeQuoteText(quoteRawText)
  if (normalizedQuote.length === 0) return { outcome: 'empty_quote' }

  const exactAt = findBoundaryValidOccurrence(source.rawText, quoteRawText, 0)
  if (exactAt >= 0) {
    return {
      outcome: 'match',
      exact: true,
      fragmentIndexes: overlappingFragments(
        source.rawRanges,
        exactAt,
        exactAt + quoteRawText.length,
      ),
    }
  }

  if (source.normalizedRanges.length === 0) return { outcome: 'no_fragments' }

  const normalizedAt = findBoundaryValidOccurrence(
    source.normalizedText,
    normalizedQuote,
    0,
  )
  if (normalizedAt >= 0) {
    return {
      outcome: 'match',
      exact: false,
      fragmentIndexes: overlappingFragments(
        source.normalizedRanges,
        normalizedAt,
        normalizedAt + normalizedQuote.length,
      ),
    }
  }

  // An ellipsis the source does not contain is an elision: what was omitted
  // cannot be known, so the comparison is inconclusive rather than a mismatch.
  if (normalizedQuote.includes('...')) return { outcome: 'elided' }

  const quoteWords = wordTokens(normalizedQuote)
  const aligned = findAlignedSpan(quoteWords, source.normalizedWords)
  if (aligned.kind === 'none') return { outcome: 'no_match' }
  if (aligned.kind === 'ambiguous') return { outcome: 'ambiguous' }

  const spanText = source.normalizedText.slice(aligned.start, aligned.end)
  const spanWords = wordTokens(spanText).map((word) => word.text)
  return {
    outcome: 'mismatch',
    difference: classifyDifference(
      quoteWords.map((word) => word.text),
      spanWords,
      aligned.delta,
    ),
    fragmentIndexes: overlappingFragments(
      source.normalizedRanges,
      aligned.start,
      aligned.end,
    ),
  }
}

/**
 * Compare one quotation against fragment texts supplied directly. This is the
 * one-shot form; a caller comparing many quotations against one authority
 * prepares that authority once with `prepareQuoteSource` and calls
 * `compareQuoteTextAgainstPrepared` instead.
 */
export function compareQuoteText(
  quoteRawText: string,
  fragmentTexts: readonly string[],
): QuoteTextOutcome {
  const prepared = prepareQuoteSource(fragmentTexts)
  if (prepared !== null) {
    return compareQuoteTextAgainstPrepared(quoteRawText, prepared)
  }
  // With nothing to compare against, emptiness is still the quotation's own
  // property and takes precedence over the source's absence.
  return normalizeQuoteText(quoteRawText).length === 0
    ? { outcome: 'empty_quote' }
    : { outcome: 'no_fragments' }
}
