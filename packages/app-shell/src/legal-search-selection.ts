/*
 * Pure selections over a legal-search result.
 *
 * They live outside views/LegalSearchView because views/CaseLawDocumentView
 * needs them. Importing them from the view module made the whole search UI a
 * static dependency of the case routes, which the app entry chunk reaches
 * through the barrel, so every route downloaded it. Keeping the selectors in a
 * module that imports only types breaks that edge; scripts/perf/bundle-budget.mjs
 * guards the emitted chunks against its return.
 */
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
