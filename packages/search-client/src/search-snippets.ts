import type { LegalSearchHit, LegalSearchSnippet } from './index-types'
import {
  containsWholeTerm,
  createJudgmentParagraphEvidenceId,
  firstWholeTermIndex,
  normalizeExactMatchValue,
} from './search-ranking'

export function extractLegalSearchSnippets(
  hit: LegalSearchHit,
  query: string,
): LegalSearchSnippet[] {
  const paragraphs = hit.paragraphs ?? []
  const normalizedQuery = normalizeExactMatchValue(query)
  const tokens = normalizedQuery.split(' ').filter((token) => token.length > 1)
  // Normalizing is the expensive part on real judgments, so each paragraph is
  // normalized once here and the result carried through to the mapping step.
  const selectedParagraphs =
    tokens.length > 0
      ? paragraphs
          .map((paragraph, index) => {
            const normalizedText = normalizeExactMatchValue(paragraph.text)
            return {
              paragraph,
              index,
              normalizedText,
              score: snippetMatchScore(normalizedText, normalizedQuery, tokens),
            }
          })
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.index - right.index,
          )
          .slice(0, 2)
      : []

  return selectedParagraphs.map(({ paragraph, index, normalizedText }) => ({
    evidenceId: createJudgmentParagraphEvidenceId(hit.id, index + 1),
    paragraphNumber: paragraph.paragraphNumber,
    // Excerpting reads the raw text so the returned snippet keeps its original
    // casing and punctuation.
    text: trimSnippetText(paragraph.text, normalizedText, tokens),
    matchedTerms: matchedSnippetTerms(normalizedText, normalizedQuery, tokens),
    matchReason: 'body_text_match',
  }))
}

/**
 * Anchors evidence to a paragraph's position in the document, not to the number
 * the judgment prints beside it.
 *
 * Those are not the same thing. LegalDocML marks block-quoted paragraphs from a
 * cited judgment as paragraphs in their own right, carrying the quoted case's
 * numbering, and appendices restart at 1. Both put duplicate `paragraphNumber`
 * values in one document — measured at 22 duplicates in a 159-paragraph UKSC
 * judgment, and in 6 of 15 sampled documents across courts. Keying evidence on
 * that number gives two different paragraphs the same evidence id, so a
 * citation cannot identify what it cites.
 *
 * `ordinal` is 1-based position in the document's paragraph array, which the
 * parsers already assign uniquely. `paragraphNumber` is unchanged and remains
 * what a reader is shown, because "at [42]" has to say what the judgment says.
 */

function matchedSnippetTerms(
  normalizedText: string,
  normalizedQuery: string,
  tokens: string[],
) {
  if (normalizedQuery && containsWholeTerm(normalizedText, normalizedQuery)) {
    return [normalizedQuery]
  }

  return tokens.filter((token) => containsWholeTerm(normalizedText, token))
}

function snippetMatchScore(
  normalizedText: string,
  normalizedQuery: string,
  tokens: string[],
) {
  if (normalizedQuery && containsWholeTerm(normalizedText, normalizedQuery)) {
    return 3
  }
  if (tokens.every((token) => containsWholeTerm(normalizedText, token)))
    return 2
  if (tokens.some((token) => containsWholeTerm(normalizedText, token))) return 1
  return 0
}

/**
 * Body match tiers read `paragraphs`, falling back to `snippets`. A caller that
 * retrieves neither leaves every hit on tier 0 for body text, so ranking
 * collapses onto the engine score. Pass `includeParagraphs` or `includeSnippets`
 * to `search` if body tiers should participate.
 */

function trimSnippetText(text: string, matchText: string, tokens: string[]) {
  const displayText = text.replace(/\s+/g, ' ').trim()
  const maxLength = 240
  if (displayText.length <= maxLength) return displayText

  // Locating the excerpt with indexOf would centre the window on a substring
  // hit such as "test" inside "testimony", which is the defect whole-term
  // matching removed everywhere else. matchText has already received the
  // index normalization during paragraph selection.
  const matchIndex = Math.max(firstWholeTermIndex(matchText, tokens), 0)
  const normalizedStart = Math.max(matchIndex - 80, 0)
  const matchPrefix = displayText.slice(0, matchIndex)
  // ASCII, precomposed Latin-1 letters, and the folded punctuation are
  // length-preserving under this normalization. For other text, verify that
  // the normalized prefix still maps one-to-one before slicing.
  const offsetsAlign =
    /^[\x20-\x7E\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF‘’“”‐‑‒–—―]*$/u.test(
      matchPrefix,
    ) || normalizeExactMatchValue(`${matchPrefix}x`).length - 1 === matchIndex
  const rawStart = offsetsAlign
    ? normalizedStart
    : normalizedSnippetOffset(displayText, normalizedStart)
  const { start, end } = excerptWindow(
    displayText,
    rawStart,
    rawStart + maxLength,
  )
  const excerpt = displayText.slice(start, end).trim()

  return `${start > 0 ? '...' : ''}${excerpt}${end < displayText.length ? '...' : ''}`
}

/**
 * The window cut on word and, where it fits, sentence ends. A slice lands on
 * whatever character sits at the offset, so a result card read "…t by
 * becoming" and "an o…": in a product whose whole claim is that an extract is
 * the source's own words, half a word reads as a corrupted source. The start
 * moves forward to the next word boundary, and the end moves back to the last
 * sentence end inside the window, falling back to the last word boundary when
 * the window holds none.
 */
function excerptWindow(text: string, from: number, to: number) {
  let start = from
  if (start > 0) {
    const boundary = text.indexOf(' ', start)
    start = boundary === -1 ? start : boundary + 1
  }
  const end = Math.min(to, text.length)
  if (end === text.length) return { start, end }

  // A sentence end is worth cutting early for only when it keeps most of the
  // window; otherwise the excerpt would lose the words that matched.
  const earliestSentenceEnd = start + Math.floor((end - start) / 2)
  for (let index = end - 1; index >= earliestSentenceEnd; index -= 1) {
    if (/[.!?;]/.test(text[index]!) && /\s/.test(text[index + 1] ?? '')) {
      return { start, end: index + 1 }
    }
  }
  const wordBoundary = text.lastIndexOf(' ', end)
  return { start, end: wordBoundary > start ? wordBoundary : end }
}

/**
 * The same cut for a source excerpt that carries no query match: legislation
 * provision text served as a short quote on a result card.
 */
export function trimSourceExcerpt(text: string, maxLength = 240): string {
  const displayText = text.replace(/\s+/g, ' ').trim()
  if (displayText.length <= maxLength) return displayText
  const { end } = excerptWindow(displayText, 0, maxLength)
  return `${displayText.slice(0, end).trim()}...`
}

function normalizedSnippetOffset(text: string, offset: number) {
  let low = 0
  let high = text.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (normalizeExactMatchValue(text.slice(0, middle)).length < offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}
