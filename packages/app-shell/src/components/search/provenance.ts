import type { CaseLawSnippet, LegislationSearchResultHit } from './searchTypes'

const findCaseLawHost = 'caselaw.nationalarchives.gov.uk'

function sourceHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function isFindCaseLawSource(url: string): boolean {
  return sourceHost(url) === findCaseLawHost
}

export function sourceNameForUrl(url: string): string {
  const host = sourceHost(url)
  if (host === null) return url
  if (host === findCaseLawHost) {
    return 'The National Archives (Find Case Law)'
  }
  if (host === 'www.legislation.gov.uk' || host === 'legislation.gov.uk') {
    return 'legislation.gov.uk'
  }
  return host
}

export function findCaseLawUrlForDocumentId(documentId: string): string | null {
  return /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*\/\d{4}\/\d+$/u.test(documentId)
    ? `https://${findCaseLawHost}/${documentId}`
    : null
}

function judgmentPinpoint(snippet: CaseLawSnippet): string | null {
  return Number.isInteger(snippet.paragraphNumber) &&
    snippet.paragraphNumber > 0
    ? `judgment [${snippet.paragraphNumber}]`
    : null
}

export function snippetParagraphHash(snippet: CaseLawSnippet): string {
  return `para-${snippet.paragraphNumber}`
}

export function judgmentExtractLabel(snippet: CaseLawSnippet): string {
  const pinpoint = judgmentPinpoint(snippet)
  return pinpoint ? `Judgment extract · ${pinpoint}` : 'Judgment extract'
}

export function legislationExtractLabel(
  hit: LegislationSearchResultHit,
): string {
  return `Legislation extract · ${hit.provisionLabel}`
}
