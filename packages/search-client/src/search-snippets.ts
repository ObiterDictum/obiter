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
    text: trimSnippetText(paragraph.text, normalizedText, tokens),
    matchedTerms: matchedSnippetTerms(normalizedText, normalizedQuery, tokens),
    matchReason: 'body_text_match',
  }))
}

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

function trimSnippetText(text: string, matchText: string, tokens: string[]) {
  const displayText = text.replace(/\s+/g, ' ').trim()
  const maxLength = 240
  if (displayText.length <= maxLength) return displayText

  const matchIndex = Math.max(firstWholeTermIndex(matchText, tokens), 0)
  const normalizedStart = Math.max(matchIndex - 80, 0)
  const matchPrefix = displayText.slice(0, matchIndex)
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

function excerptWindow(text: string, from: number, to: number) {
  let start = from
  if (start > 0) {
    const boundary = text.indexOf(' ', start)
    start = boundary === -1 ? start : boundary + 1
  }
  const end = Math.min(to, text.length)
  if (end === text.length) return { start, end }

  const earliestSentenceEnd = start + Math.floor((end - start) / 2)
  for (let index = end - 1; index >= earliestSentenceEnd; index -= 1) {
    if (/[.!?;]/.test(text[index]!) && /\s/.test(text[index + 1] ?? '')) {
      return { start, end: index + 1 }
    }
  }
  const wordBoundary = text.lastIndexOf(' ', end)
  return { start, end: wordBoundary > start ? wordBoundary : end }
}

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
