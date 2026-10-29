import { APOSTROPHE_MARKS, normalizeQuoteText } from './quote-normalization'

const WORD_CHARACTER = /^[\p{L}\p{N}\p{M}]$/u

const APOSTROPHE = new Set(APOSTROPHE_MARKS)

const WORD_PATTERN = new RegExp(
  `${apostropheClass()}*[\\p{L}\\p{N}\\p{M}]+` +
    `(?:${apostropheClass()}+[\\p{L}\\p{N}\\p{M}]+)*` +
    `${apostropheClass()}*`,
  'gu',
)

function apostropheClass(): string {
  return `[${APOSTROPHE_MARKS.join('')}]`
}

export type QuoteDifference =
  'punctuation' | 'reordered' | 'substituted' | 'omitted' | 'inserted'

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

export interface QuoteFragmentRange {
  start: number
  end: number
  fragmentIndex: number
}

export interface QuoteWordToken {
  text: string
  start: number
  end: number
}

export interface PreparedQuoteSource {
  readonly rawText: string
  readonly normalizedText: string
  readonly normalizedWords: readonly QuoteWordToken[]
  readonly rawRanges: readonly QuoteFragmentRange[]
  readonly normalizedRanges: readonly QuoteFragmentRange[]
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

export function compareQuoteTextAgainstPrepared(
  quoteRawText: string,
  source: PreparedQuoteSource,
): QuoteTextOutcome {
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

export function compareQuoteText(
  quoteRawText: string,
  fragmentTexts: readonly string[],
): QuoteTextOutcome {
  const prepared = prepareQuoteSource(fragmentTexts)
  if (prepared !== null) {
    return compareQuoteTextAgainstPrepared(quoteRawText, prepared)
  }
  return normalizeQuoteText(quoteRawText).length === 0
    ? { outcome: 'empty_quote' }
    : { outcome: 'no_fragments' }
}
