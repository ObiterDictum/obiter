import type { CaseLawSnippet, LegislationSearchResultHit } from './searchTypes'

/**
 * The source's own name, read from the URL the API stored. Never assumed: a
 * hit from another provider must be labelled with its own host, not Find Case
 * Law's. The two hosts the corpus serves today have product names; anything
 * else falls back to the host itself rather than inventing a source.
 */
export function sourceNameForUrl(url: string): string {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    return url
  }
  if (host === 'caselaw.nationalarchives.gov.uk') {
    return 'The National Archives (Find Case Law)'
  }
  if (host === 'www.legislation.gov.uk' || host === 'legislation.gov.uk') {
    return 'legislation.gov.uk'
  }
  return host
}

/**
 * The Find Case Law page for a stored judgment, derived from a document id
 * that is the provider's own slug (uksc/2018/24). Null for any other id: a
 * page whose record failed to load must not point at a URL we guessed wrong.
 */
export function findCaseLawUrlForDocumentId(documentId: string): string | null {
  return /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*\/\d{4}\/\d+$/u.test(documentId)
    ? `https://caselaw.nationalarchives.gov.uk/${documentId}`
    : null
}

/** The pinpoint a snippet came from, or null when the data has no paragraph. */
function judgmentPinpoint(snippet: CaseLawSnippet): string | null {
  return Number.isInteger(snippet.paragraphNumber) &&
    snippet.paragraphNumber > 0
    ? `judgment [${snippet.paragraphNumber}]`
    : null
}

export function snippetParagraphHash(snippet: CaseLawSnippet): string {
  return `para-${snippet.paragraphNumber}`
}

/** A short, honest label for the extraction a result or preview is showing. */
export function judgmentExtractLabel(snippet: CaseLawSnippet): string {
  const pinpoint = judgmentPinpoint(snippet)
  return pinpoint ? `Judgment extract · ${pinpoint}` : 'Judgment extract'
}

export function legislationExtractLabel(
  hit: LegislationSearchResultHit,
): string {
  return `Legislation extract · ${hit.provisionLabel}`
}
