import type { Pool } from 'pg'
import {
  decideCitationResolution,
  decideQuoteFidelity,
  normalizedCitationFromResolution,
  type CitationInput,
  type NormalizedCitation,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import { checkAuthorityExistence } from './authority-existence'
import { resolveCitationCandidates } from './citation-resolution'
import {
  checkQuoteFidelities,
  maxQuoteFidelityBatchSize,
  type QuoteCheckResult,
  type QuoteFidelityRequest,
} from './quote-fidelity'
import type {
  ExtractedCitation,
  ExtractedQuote,
} from './verification-extraction'

function unresolvedCitation(): NormalizedCitation {
  return { kind: 'unresolved', reason: 'not_a_citation' }
}

function quoteFinding(result: QuoteCheckResult, request: QuoteFidelityRequest) {
  if (result.outcome === 'finding') return result.finding
  const source =
    result.reason === 'source_identity_conflict'
      ? {
          outcome: 'unavailable' as const,
          reason: 'identity_mismatch' as const,
        }
      : { outcome: 'not_checked' as const }
  return decideQuoteFidelity({
    subject: request.subject,
    quote: request.quote,
    normalizedCitation: request.normalizedCitation,
    source,
  })
}

/** Wire V3, V2 and V4 onto one extracted document. Findings keep V1 identities. */
export async function collectVerificationFindings(
  pool: Pick<Pool, 'query'>,
  subject: VerificationSubject,
  citations: ExtractedCitation[],
  quotes: ExtractedQuote[],
) {
  const findings: VerificationFinding[] = []
  const resolutions = await resolveCitationCandidates(
    pool,
    citations.map((citation) => ({
      id: citation.id,
      rawText: citation.rawText,
    })),
  )
  const resolvedById = new Map(
    resolutions.map((item) => [item.id, item.resolution]),
  )
  const normalizedById = new Map<string, NormalizedCitation>()
  for (const citation of citations) {
    const location = {
      paragraphId: citation.paragraphId,
      start: citation.start,
      end: citation.end,
    }
    const input: CitationInput = { rawText: citation.rawText, location }
    const resolution = resolvedById.get(citation.id)
    if (!resolution) continue
    const normalized = normalizedCitationFromResolution(resolution)
    normalizedById.set(citation.id, normalized)
    findings.push(
      decideCitationResolution({
        subject,
        citation: input,
        resolution,
      }),
    )
    findings.push(
      await checkAuthorityExistence(pool, {
        subject,
        citation: input,
        normalizedCitation: normalized,
      }),
    )
  }

  const quoteRequests: QuoteFidelityRequest[] = quotes.map((quote) => ({
    subject,
    quote: {
      rawText: quote.rawText,
      location: {
        paragraphId: quote.paragraphId,
        start: quote.start,
        end: quote.end,
      },
    },
    normalizedCitation: quote.attributedCitationId
      ? (normalizedById.get(quote.attributedCitationId) ?? unresolvedCitation())
      : unresolvedCitation(),
  }))
  for (let index = 0; index < quoteRequests.length;) {
    const batch = quoteRequests.slice(index, index + maxQuoteFidelityBatchSize)
    const results = await checkQuoteFidelities(pool, batch)
    for (const [offset, result] of results.entries()) {
      const request = batch[offset]
      if (!request || !result) continue
      findings.push(quoteFinding(result, request))
    }
    index += maxQuoteFidelityBatchSize
  }
  return findings
}
