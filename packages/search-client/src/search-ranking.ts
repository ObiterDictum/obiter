import type { EngineRankingHit, LegalSearchHit } from './index-types'
import { legalStopWordSet } from './index-settings'

export function createJudgmentParagraphEvidenceId(
  documentId: string,
  ordinal: number,
) {
  return `${documentId}:judgment_paragraph:${ordinal}`
}

export function rankLegalSearchHitsByExactMatch<T extends LegalSearchHit>(
  hits: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeExactMatchValue(query)
  if (!normalizedQuery) return hits

  return hits
    .map((hit, index) => ({
      hit,
      index,
      matchTier: legalSearchMatchTier(hit, normalizedQuery),
      courtSeniority: courtSeniorityForRanking(hit.court),
      engineRankingScore: validEngineRankingScore(hit.engineRankingScore) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.matchTier - left.matchTier ||
        right.courtSeniority - left.courtSeniority ||
        right.engineRankingScore - left.engineRankingScore ||
        left.index - right.index,
    )
    .map(({ hit }) => hit)
}

function courtSeniorityForRanking(court: string | null | undefined) {
  const normalized = court?.trim().toLowerCase() ?? ''
  if (normalized === 'uksc') return 4
  if (normalized === 'ukpc') return 3
  if (normalized.startsWith('ewca')) return 2
  if (normalized.startsWith('ewhc')) return 1
  return 0
}

function legalSearchMatchTier(hit: LegalSearchHit, normalizedQuery: string) {
  const normalizedTitle = normalizeExactMatchValue(hit.title)

  if (normalizeExactMatchValue(hit.id) === normalizedQuery) return 9
  if (
    normalizeCitationValue(hit.neutralCitation) ===
    normalizeCitationValue(normalizedQuery)
  )
    return 8
  if (normalizedTitle === normalizedQuery) return 7
  if (containsWholeTerm(normalizedTitle, normalizedQuery)) return 6
  if (titleContainsEveryQueryTerm(normalizedTitle, normalizedQuery)) return 5
  if (titleContainsAnySearchableQueryTerm(normalizedTitle, normalizedQuery))
    return 4

  const bodySegments = hit.paragraphs?.length
    ? hit.paragraphs.map(({ text }) => text)
    : (hit.snippets?.map(({ text }) => text) ?? [])
  const normalizedSegments = bodySegments.map(normalizeExactMatchValue)
  if (
    normalizedSegments.some((text) => containsWholeTerm(text, normalizedQuery))
  ) {
    return 3
  }

  const normalizedBody = normalizedSegments.join(' ')
  if (containsEveryNormalizedQueryTerm(normalizedBody, normalizedQuery))
    return 2
  if (containsAnyNormalizedQueryTerm(normalizedBody, normalizedQuery)) return 1
  return 0
}

export function readEngineRankingScore(hit: EngineRankingHit) {
  return validEngineRankingScore(hit._rankingScore)
}

function validEngineRankingScore(value: unknown) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined
}

export const exactMatchPunctuationFolds = [
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['‐', '-'],
  ['‑', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
] as const

export function normalizeExactMatchValue(value: string | null | undefined) {
  const punctuationFolded = exactMatchPunctuationFolds.reduce(
    (normalized, [from, to]) => normalized.replaceAll(from, to),
    value?.normalize('NFKC') ?? '',
  )

  return punctuationFolded
    .trim()
    .toLocaleLowerCase('en-GB')
    .replace(/\s+/g, ' ')
}

export function normalizeCitationValue(value: string | null | undefined) {
  return normalizeExactMatchValue(value).replace(
    /(?<![\p{L}\p{M}\p{N}_])0+(\d)/gu,
    '$1',
  )
}

export function containsEveryQueryTerm(value: string, query: string) {
  return containsEveryNormalizedQueryTerm(
    normalizeExactMatchValue(value),
    normalizeExactMatchValue(query),
  )
}

function containsEveryNormalizedQueryTerm(
  normalizedValue: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return (
    terms.length > 0 &&
    terms.every((term) => containsWholeTerm(normalizedValue, term))
  )
}

export function titleContainsEveryQueryTerm(
  normalizedTitle: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  if (terms.length === 0) return false
  const titleWords = normalizedTitle.split(' ').filter(Boolean)
  return terms.every(
    (term) =>
      containsWholeTerm(normalizedTitle, term) ||
      isTitleAcronym(term, titleWords),
  )
}

export function titleContainsAnySearchableQueryTerm(
  normalizedTitle: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return terms.some(
    (term) =>
      term.length > 1 &&
      !legalStopWordSet.has(term) &&
      containsWholeTerm(normalizedTitle, term),
  )
}

function isTitleAcronym(term: string, titleWords: string[]) {
  if (term.length < 2) return false
  return titleWords.some((_, start) =>
    term
      .split('')
      .every((letter, offset) => titleWords[start + offset]?.[0] === letter),
  )
}

function containsAnyNormalizedQueryTerm(
  normalizedValue: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return terms.some((term) => containsWholeTerm(normalizedValue, term))
}

const wholeTermPatterns = new Map<string, RegExp>()
const wholeTermPatternLimit = 500

function wholeTermPattern(term: string) {
  const cached = wholeTermPatterns.get(term)
  if (cached) return cached

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])${escapeRegularExpression(term)}(?![\\p{L}\\p{M}\\p{N}_])`,
    'u',
  )
  wholeTermPatterns.set(term, pattern)

  const oldestTerm = wholeTermPatterns.keys().next().value
  if (wholeTermPatterns.size > wholeTermPatternLimit && oldestTerm) {
    wholeTermPatterns.delete(oldestTerm)
  }

  return pattern
}

export function containsWholeTerm(value: string, term: string) {
  if (!term) return false
  return wholeTermPattern(term).test(value)
}

export function firstWholeTermIndex(value: string, terms: string[]) {
  const indexes = terms
    .map((term) =>
      term ? (wholeTermPattern(term).exec(value)?.index ?? -1) : -1,
    )
    .filter((index) => index >= 0)

  return indexes.length > 0 ? Math.min(...indexes) : -1
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
