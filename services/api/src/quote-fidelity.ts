import type { Pool } from 'pg'
import {
  decideQuoteFidelity,
  type CitationInput,
  type NormalizedCitation,
  type QuoteFragment,
  type QuoteSourceOutcome,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import {
  createPostgresLegalAuthoritySourceStore,
  MalformedStoredRecordError,
} from './routes/legal-search/source-store'
import {
  getLegislationDocument,
  getLegislationProvision,
  legislationProvisionPathExists,
  provisionTextServable,
  resolveStoredProvisionPath,
} from './routes/legal-search/legislation-store'

/**
 * The quote-fidelity store boundary (V4). It reads the stored public
 * legal-source record for a citation V3 already resolved, turns it into the
 * fragments the pure comparison acts on, and hands both to
 * `decideQuoteFidelity`. It makes no comparison decision itself, reads no
 * matter data, calls no provider or model, and never writes.
 *
 * Retrieval is scoped to the resolved citation: one judgment document, or the
 * one provision lineage the citation names. The batch entry point reads each
 * distinct source once for any number of quotations from it, so a document with
 * many quotes pays one read, and an empty batch pays none.
 */

/** The bounded request size the check accepts. A request over it is a client
 * error at the boundary, not a check outcome. */
export const maxQuoteLength = 4000
export const maxSourceFragments = 10_000
export const maxSourceCharacters = 4_000_000

export class QuoteRequestTooLargeError extends Error {
  constructor() {
    super(`A quote check accepts at most ${maxQuoteLength} UTF-16 code units.`)
    this.name = 'QuoteRequestTooLargeError'
  }
}

export interface QuoteFidelityRequest {
  subject: VerificationSubject
  /** The quotation: its exact draft text and the span it occupies. */
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

/**
 * One quote-fidelity finding. Delegates to the batch so there is a single
 * retrieval implementation.
 */
export async function checkQuoteFidelity(
  pool: Pick<Pool, 'query'>,
  request: QuoteFidelityRequest,
): Promise<VerificationFinding> {
  const [finding] = await checkQuoteFidelities(pool, [request])
  if (!finding) {
    throw new Error('Quote fidelity returned no finding for one request.')
  }
  return finding
}

/**
 * Batch entry point: one quote-fidelity finding per request, in input order.
 * Quotations that share a resolved source share one store read, and an empty
 * batch issues no query at all.
 */
export async function checkQuoteFidelities(
  pool: Pick<Pool, 'query'>,
  requests: readonly QuoteFidelityRequest[],
): Promise<VerificationFinding[]> {
  if (requests.length === 0) return []
  for (const request of requests) {
    if (request.quote.rawText.length > maxQuoteLength) {
      throw new QuoteRequestTooLargeError()
    }
  }

  // One promised read per distinct resolved source, shared across the quotations
  // that cite it. The promise never rejects: a failed read becomes an
  // `unavailable` outcome, so a partial source failure only affects the quotes
  // that needed that source.
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
    requests.map(async (request) =>
      decideQuoteFidelity({
        subject: request.subject,
        quote: request.quote,
        normalizedCitation: request.normalizedCitation,
        source: await sourceFor(request.normalizedCitation),
      }),
    ),
  )
}

function sourceKey(citation: ResolvedCitation): string {
  return citation.kind === 'case_law'
    ? `judgment:${citation.sourceId}`
    : `legislation:${citation.documentIdentity}:${citation.labelPath ?? ''}`
}

/**
 * Read the trustworthy fragments of one resolved source. A failure raised at
 * the store boundary is classified; anything else propagates, so a bug in this
 * file cannot be reported as a database outage. Nothing in the diagnostic is a
 * quotation or matter text.
 */
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

async function loadCaseLawSource(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'case_law' }>,
): Promise<QuoteSourceOutcome> {
  const store = createPostgresLegalAuthoritySourceStore(pool)
  const record = await store.get(citation.sourceId)
  if (!record) return { outcome: 'unavailable', reason: 'source_not_held' }
  if (record.withdrawn) {
    return { outcome: 'unavailable', reason: 'source_withdrawn' }
  }
  const document = record.document
  if (!document) {
    // A summary-only record is a held authority with no stored body, so it has
    // no fragment a quotation could be compared against.
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
    ? { outcome: 'ready', fragments: bounded }
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
        !provisionTextServable(
          provision.hasUnappliedEffects,
          provision.effectsCheckedAt,
        )
      ) {
        // The stored text is not a verified current version, so a difference
        // against it would not be a trustworthy mismatch.
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
        ? { outcome: 'ready', fragments: bounded }
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
