import type { Pool } from 'pg'
import {
  decideQuoteFidelity,
  createEvidenceReferenceId,
  prepareQuoteSource,
  quoteSpanViolation,
  QuoteSourceMismatchError,
  type CitationInput,
  type NormalizedCitation,
  type QuoteFragment,
  type QuoteSourceOutcome,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import {
  createPostgresLegalAuthorityReadStore,
  MalformedStoredRecordError,
} from './routes/legal-search/source-store'
import {
  getLegislationDocument,
  getLegislationProvision,
  legislationProvisionPathExists,
  provisionTextServable,
  resolveStoredProvisionPath,
} from './routes/legal-search/legislation-store'

export const maxQuoteLength = 4000
export const maxSourceFragments = 10_000
const maxSourceCharacters = 4_000_000

export const maxQuoteFidelityBatchSize = 200

export class QuoteRequestTooLargeError extends Error {
  constructor() {
    super(`A quote check accepts at most ${maxQuoteLength} UTF-16 code units.`)
    this.name = 'QuoteRequestTooLargeError'
  }
}

export class QuoteBatchTooLargeError extends Error {
  constructor() {
    super(
      `A quote check accepts at most ${maxQuoteFidelityBatchSize} requests at once.`,
    )
    this.name = 'QuoteBatchTooLargeError'
  }
}

type QuoteCheckRejectionReason =
  | 'quote_blank'
  | 'quote_too_large'
  | 'quote_span_mismatch'
  | 'source_identity_conflict'

export type QuoteCheckResult =
  | { outcome: 'finding'; finding: VerificationFinding }
  | { outcome: 'rejected'; reason: QuoteCheckRejectionReason }

class QuoteRequestInvalidError extends Error {
  readonly reason: Extract<
    QuoteCheckRejectionReason,
    'quote_blank' | 'quote_span_mismatch'
  >

  constructor(
    reason: Extract<
      QuoteCheckRejectionReason,
      'quote_blank' | 'quote_span_mismatch'
    >,
  ) {
    super(
      reason === 'quote_blank'
        ? 'A quotation must carry comparable text; a blank quotation has no finding.'
        : 'A quotation must be the draft slice its location names.',
    )
    this.name = 'QuoteRequestInvalidError'
    this.reason = reason
  }
}

export interface QuoteFidelityRequest {
  subject: VerificationSubject
  quote: CitationInput
  normalizedCitation: NormalizedCitation
}

type ResolvedCitation = Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
>

function isResolved(
  citation: NormalizedCitation,
): citation is ResolvedCitation {
  return citation.kind === 'case_law' || citation.kind === 'legislation'
}

export async function checkQuoteFidelity(
  pool: Pick<Pool, 'query'>,
  request: QuoteFidelityRequest,
): Promise<VerificationFinding> {
  const [result] = await checkQuoteFidelities(pool, [request])
  if (result === undefined) {
    throw new Error('Quote fidelity returned no result for one request.')
  }
  if (result.outcome === 'finding') return result.finding
  switch (result.reason) {
    case 'quote_too_large':
      throw new QuoteRequestTooLargeError()
    case 'source_identity_conflict':
      throw new QuoteSourceMismatchError(
        'The stored source contradicts the resolved citation.',
      )
    default:
      throw new QuoteRequestInvalidError(result.reason)
  }
}

export async function checkQuoteFidelities(
  pool: Pick<Pool, 'query'>,
  requests: readonly QuoteFidelityRequest[],
): Promise<QuoteCheckResult[]> {
  if (requests.length === 0) return []
  if (requests.length > maxQuoteFidelityBatchSize) {
    throw new QuoteBatchTooLargeError()
  }

  const sourceReads = new Map<string, Promise<QuoteSourceOutcome>>()
  const sourceFor = (
    citation: NormalizedCitation,
  ): Promise<QuoteSourceOutcome> => {
    if (!isResolved(citation))
      return Promise.resolve({ outcome: 'not_checked' })
    const key = sourceKey(citation)
    let read = sourceReads.get(key)
    if (!read) {
      read = loadQuoteSource(pool, citation)
      sourceReads.set(key, read)
    }
    return read
  }

  return Promise.all(
    requests.map(async (request): Promise<QuoteCheckResult> => {
      const reason = rejectionReason(request)
      if (reason !== null) return { outcome: 'rejected', reason }
      const source = await sourceFor(request.normalizedCitation)
      try {
        const finding = decideQuoteFidelity({
          subject: request.subject,
          quote: request.quote,
          normalizedCitation: request.normalizedCitation,
          source,
        })
        const passages =
          source.outcome === 'ready'
            ? finding.evidence.flatMap((reference) => {
                const fragment = source.fragments.find(
                  (item) =>
                    item.sourceType === reference.sourceType &&
                    item.sourceId === reference.sourceId &&
                    reference.granularity === 'fragment' &&
                    (item.sourceType === 'judgment' &&
                    reference.sourceType === 'judgment'
                      ? item.ordinal === reference.ordinal
                      : item.sourceType === 'legislation_provision' &&
                        reference.sourceType === 'legislation_provision' &&
                        item.labelPath === reference.labelPath),
                )
                return fragment
                  ? [
                      {
                        evidenceId: createEvidenceReferenceId(reference),
                        text: fragment.text,
                      },
                    ]
                  : []
              })
            : []
        return {
          outcome: 'finding',
          finding: { ...finding, passages },
        }
      } catch (error) {
        if (error instanceof QuoteSourceMismatchError) {
          console.warn('Quote fidelity source integrity conflict', {
            message: error.message,
          })
          return { outcome: 'rejected', reason: 'source_identity_conflict' }
        }
        throw error
      }
    }),
  )
}

function rejectionReason(
  request: QuoteFidelityRequest,
): QuoteCheckRejectionReason | null {
  const violation = quoteSpanViolation(request.quote)
  if (violation === 'blank') return 'quote_blank'
  if (violation === 'length_mismatch') return 'quote_span_mismatch'
  if (request.quote.rawText.length > maxQuoteLength) return 'quote_too_large'
  return null
}

function sourceKey(citation: ResolvedCitation): string {
  return citation.kind === 'case_law'
    ? `judgment:${citation.sourceId}`
    : `legislation:${citation.documentIdentity}:${citation.labelPath ?? ''}`
}

async function loadQuoteSource(
  pool: Pick<Pool, 'query'>,
  citation: ResolvedCitation,
): Promise<QuoteSourceOutcome> {
  try {
    return citation.kind === 'case_law'
      ? await loadCaseLawSource(pool, citation)
      : await loadLegislationSource(pool, citation)
  } catch (error) {
    if (error instanceof MalformedStoredRecordError) {
      return { outcome: 'unavailable', reason: 'source_malformed' }
    }
    console.warn('Quote fidelity store read failed', {
      message: error instanceof Error ? error.message : null,
    })
    return { outcome: 'unavailable', reason: 'source_unreadable' }
  }
}

function boundedFragments(fragments: QuoteFragment[]): QuoteFragment[] | null {
  if (fragments.length > maxSourceFragments) return null
  let characters = 0
  for (const fragment of fragments) characters += fragment.text.length
  return characters > maxSourceCharacters ? null : fragments
}

function readyOutcome(
  fragments: QuoteFragment[],
  resolvedProvision?: { documentIdentity: string; labelPath: string },
): QuoteSourceOutcome {
  const preparedSource = prepareQuoteSource(
    fragments.map((fragment) => fragment.text),
  )
  if (preparedSource === null) {
    return { outcome: 'unavailable', reason: 'no_source_fragments' }
  }
  return { outcome: 'ready', fragments, preparedSource, resolvedProvision }
}

async function loadCaseLawSource(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'case_law' }>,
): Promise<QuoteSourceOutcome> {
  const store = createPostgresLegalAuthorityReadStore(pool)
  const record = await store.get(citation.sourceId)
  if (!record) return { outcome: 'unavailable', reason: 'source_not_held' }
  if (record.withdrawn) {
    return { outcome: 'unavailable', reason: 'source_withdrawn' }
  }
  const document = record.document
  if (!document) {
    return { outcome: 'unavailable', reason: 'no_source_fragments' }
  }
  if (document.id !== citation.sourceId) {
    return { outcome: 'unavailable', reason: 'identity_mismatch' }
  }
  const fragments: QuoteFragment[] = (document.paragraphs ?? []).map(
    (paragraph, index) => ({
      sourceType: 'judgment',
      sourceId: citation.sourceId,
      ordinal: index + 1,
      paragraphNumber: paragraph.paragraphNumber,
      text: paragraph.text,
    }),
  )
  if (fragments.length === 0) {
    return { outcome: 'unavailable', reason: 'no_source_fragments' }
  }
  const bounded = boundedFragments(fragments)
  return bounded
    ? readyOutcome(bounded)
    : { outcome: 'unavailable', reason: 'source_too_large' }
}

async function loadLegislationSource(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'legislation' }>,
): Promise<QuoteSourceOutcome> {
  if (citation.labelPath === null) {
    return { outcome: 'unavailable', reason: 'no_addressable_provision' }
  }
  const document = await getLegislationDocument(pool, citation.documentIdentity)
  if (!document) return { outcome: 'unavailable', reason: 'source_not_held' }

  const resolution = await resolveStoredProvisionPath(
    {
      getProvision: (provisionId) => getLegislationProvision(pool, provisionId),
      pathExists: (identity, labelPath) =>
        legislationProvisionPathExists(pool, identity, labelPath),
    },
    citation.documentIdentity,
    citation.labelPath,
  )
  switch (resolution.status) {
    case 'held': {
      const provision = resolution.provision
      if (
        provision.documentIdentity !== citation.documentIdentity ||
        provision.id !== `${citation.documentIdentity}/${provision.labelPath}`
      ) {
        return { outcome: 'unavailable', reason: 'identity_mismatch' }
      }
      if (
        !provisionTextServable(
          provision.hasUnappliedEffects,
          provision.effectsCheckedAt,
        )
      ) {
        return { outcome: 'unavailable', reason: 'source_text_unverified' }
      }
      const fragments: QuoteFragment[] = [
        {
          sourceType: 'legislation_provision',
          sourceId: citation.documentIdentity,
          labelPath: provision.labelPath,
          text: provision.text,
        },
      ]
      if (fragments[0]?.text.trim().length === 0) {
        return { outcome: 'unavailable', reason: 'no_source_fragments' }
      }
      const bounded = boundedFragments(fragments)
      return bounded
        ? readyOutcome(bounded, {
            documentIdentity: citation.documentIdentity,
            labelPath: provision.labelPath,
          })
        : { outcome: 'unavailable', reason: 'source_too_large' }
    }
    case 'missing':
      return { outcome: 'unavailable', reason: 'missing_provision' }
    case 'underspecified':
      return { outcome: 'unavailable', reason: 'citation_underspecified' }
    default: {
      const unhandled: never = resolution
      return unhandled
    }
  }
}
