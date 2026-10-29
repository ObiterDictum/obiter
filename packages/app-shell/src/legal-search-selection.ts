import type {
  CaseLawParagraph,
  LegalSearchResult,
} from './components/search/searchTypes'

export function selectParagraphExcerpts(
  result: LegalSearchResult,
  query: string,
): CaseLawParagraph[] {
  const normalizedQuery = query.trim().toLowerCase()
  const paragraphs = result.paragraphs ?? []

  if (!normalizedQuery) {
    return paragraphs.slice(0, 3)
  }

  const matches = paragraphs.filter((paragraph) =>
    paragraph.text.toLowerCase().includes(normalizedQuery),
  )

  return (matches.length > 0 ? matches : paragraphs).slice(0, 3)
}

export function selectJudgmentParagraphs(
  result: LegalSearchResult,
): CaseLawParagraph[] {
  return result.paragraphs ?? []
}
