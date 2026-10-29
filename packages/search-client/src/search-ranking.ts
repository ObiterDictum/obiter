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

  return (
    hits
      .map((hit, index) => ({
        hit,
        index,
        matchTier: legalSearchMatchTier(hit, normalizedQuery),
        courtSeniority: courtSeniorityForRanking(hit.court),
        engineRankingScore:
          validEngineRankingScore(hit.engineRankingScore) ?? 0,
      }))
      // Legal match tiers express user intent. Within a tier the higher
      // court goes first: for an ambiguous party name the apex-court
      // decision is usually the wanted one, and a bare surname otherwise
      // drowns it under dozens of same-tier lower-court title matches.
      // Engine scores break remaining ties, then ties preserve the
      // caller's or engine's supplied order. An
      // equal engine score is not equal engine relevance: it is one lossy number
      // summarising the words, typo, proximity, attribute, exactness and sort
      // cascade, so the supplied order still carries signal the score has lost.
      .sort(
        (left, right) =>
          right.matchTier - left.matchTier ||
          right.courtSeniority - left.courtSeniority ||
          right.engineRankingScore - left.engineRankingScore ||
          left.index - right.index,
      )
      .map(({ hit }) => hit)
  )
}

/**
 * Precedent hierarchy for within-tier ranking: UKSC, then the Privy Council,
 * then the Court of Appeal divisions, then the High Court, then anything
 * else (unreported and unknown courts). Only ever a tiebreak inside one
 * match tier, so an exact citation or id match never loses to it.
 */
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
  // A title carrying one distinctive query term outranks any body mention.
  // A misspelled party query defeats every whole-title tier, and without
  // this the title-bearing judgment ties the body mentions and loses on the
  // seniority tiebreak. Title evidence still ranks below every whole-title
  // tier, so full title matches keep their priority.
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

/**
 * Citation-strength normalization: everything `normalizeExactMatchValue` does,
 * plus dropping leading zeros from digit runs.
 *
 * Tribunals pad the number in a neutral citation and the senior courts do not.
 * Find Case Law returns `[2024] UKUT 00236 (IAC)` and `[2024] UKFTT 001074 (TC)`
 * alongside `[2024] UKSC 22`. A reader types the unpadded form, because that is
 * what the tribunal's own headnote and every citing judgment print, so exact
 * citation matching missed every padded citation and quietly degraded to
 * keyword search across UKUT and UKFTT.
 *
 * Applied to both sides of a citation comparison, never to titles: a title may
 * legitimately contain a zero-padded number that is part of a name.
 */
export function normalizeCitationValue(value: string | null | undefined) {
  return normalizeExactMatchValue(value).replace(
    /(?<![\p{L}\p{M}\p{N}_])0+(\d)/gu,
    '$1',
  )
}

/**
 * Normalizes both arguments before checking that every whitespace-delimited
 * query term appears as a whole term.
 */
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

/**
 * Title form of the every-term check (rank tier 5): a term also matches as
 * the initials of consecutive title words. Parties are routinely cited by
 * acronym (FCA for the Financial Conduct Authority), and the acronym never
 * appears in the decision's own title, so a literal-only check caps such
 * queries at the body tiers while dozens of citing judgments carry the
 * literal phrase and outrank the decision itself. Title-only: prose throws
 * up accidental initialisms everywhere, so body matching stays literal.
 *
 * Both arguments must already be normalized with `normalizeExactMatchValue`.
 * Exported so the API's served match-reason labels read the same title
 * evidence the rank tiers do; a second local definition would let ranking
 * and labels drift.
 */
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

/**
 * Title-partial check (rank tier 4): one distinctive query term in the
 * title. Stop words and single-character terms never count, so the "v"
 * every party name carries cannot promote a title on its own. Title-only,
 * like the every-term check it refines: prose throws up accidental matches.
 *
 * Both arguments must already be normalized with `normalizeExactMatchValue`.
 * Exported for served-label parity, as `titleContainsEveryQueryTerm` is.
 */
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

/** A term of two or more letters matching the first letters of that many
 * consecutive title words: FCA against financial conduct authority. */
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

// Terms come from user queries, so the key space is unbounded and the cache
// needs an explicit ceiling.
const wholeTermPatterns = new Map<string, RegExp>()
const wholeTermPatternLimit = 500

function wholeTermPattern(term: string) {
  const cached = wholeTermPatterns.get(term)
  if (cached) return cached

  // No `g` or `y` flag, so the pattern holds no `lastIndex` state and stays
  // safe to reuse across calls.
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

/**
 * Checks normalized text and term values for a whole-term match. Normalize
 * both inputs with `normalizeExactMatchValue` before calling this helper.
 */
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
