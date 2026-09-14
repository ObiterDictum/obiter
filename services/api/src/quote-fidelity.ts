import type { Pool } from 'pg'
import {
  decideQuoteFidelity,
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
 * distinct source once for any number of quotations from it, and prepares that
 * source's comparison representation once, so a document with many quotations
 * pays one read and one normalisation rather than one per quotation. An empty
 * batch pays nothing.
 *
 * A candidate that the boundary cannot check is reported as one rejected entry
 * beside its siblings' findings, never as a thrown error that would discard
 * them. Only a caller-level contract violation that no candidate could recover
 * from, an oversized batch, rejects the call.
 */

/** The bounded request size the check accepts. A request over it is a rejected
 * candidate, not a batch failure. */
export const maxQuoteLength = 4000
export const maxSourceFragments = 10_000
export const maxSourceCharacters = 4_000_000

/** The bounded number of candidates one call accepts. Each candidate still
 * costs a bounded scan of its source, so the batch bound is what keeps one
 * call's work finite and predictable. V5 chunks a document's quotations into
 * batches of at most this size and concatenates the results, which is why
 * results come back one per request in input order. */
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

/** Why one candidate produced no finding. Every reason describes that candidate
 * alone: none of them is a batch failure, and none of them is a comparison
 * result, so a rejected candidate can never be read as a pass or a mismatch. */
export type QuoteCheckRejectionReason =
  | 'quote_blank'
  | 'quote_too_large'
  | 'quote_span_mismatch'
  | 'source_identity_conflict'

/** One request's outcome. The array preserves input order and length, so a
 * caller can align results with requests and chunk without losing a candidate. */
export type QuoteCheckResult =
  | { outcome: 'finding'; finding: VerificationFinding }
  | { outcome: 'rejected'; reason: QuoteCheckRejectionReason }

/** A request that V1's finding model cannot carry: a blank quotation, or a
 * quotation that is not the draft slice its location names. Raised only by the
 * single-request entry point, where there is no sibling to preserve. */
export class QuoteRequestInvalidError extends Error {
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
 * retrieval implementation. A candidate the boundary cannot check raises here
 * rather than returning, because a one-request call has no sibling to protect
 * and a caller that asked for one finding should not have to interpret a
 * rejection entry.
 */
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

/**
 * Batch entry point: one outcome per request, in input order. Quotations that
 * share a resolved source share one store read and one source preparation, an
 * empty batch issues no query at all, and a candidate that cannot be checked
 * does not affect its siblings.
 */
export async function checkQuoteFidelities(
  pool: Pick<Pool, 'query'>,
  requests: readonly QuoteFidelityRequest[],
): Promise<QuoteCheckResult[]> {
  if (requests.length === 0) return []
  if (requests.length > maxQuoteFidelityBatchSize) {
    throw new QuoteBatchTooLargeError()
  }

  // One promised read and one preparation per distinct resolved source, shared
  // across the quotations that cite it. The promise never rejects: a failed read
  // becomes an `unavailable` outcome, so a partial source failure only affects
  // the quotes that needed that source.
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
        return {
          outcome: 'finding',
          finding: decideQuoteFidelity({
            subject: request.subject,
            quote: request.quote,
            normalizedCitation: request.normalizedCitation,
            source,
          }),
        }
      } catch (error) {
        if (error instanceof QuoteSourceMismatchError) {
          // The store boundary produced fragments that contradict the citation
          // it resolved: an expected source-integrity failure, not a comparison
          // result. It is confined to this candidate and reported as a
          // rejection, and the diagnostic carries the message only, never the
          // quotation.
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

/**
 * Why this candidate cannot produce a finding, or null when it can. The
 * quotation-span contract is V4's own (`quoteSpanViolation`), so the boundary
 * and the decision cannot disagree about what a valid span is.
 */
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

/**
 * A ready outcome for a bounded fragment set, with the source prepared once for
 * every quotation that will cite it. A set with no comparable text at all is
 * `no_source_fragments` rather than a ready empty source.
 */
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
      // The row must be the row that was asked for. A resolution helper that
      // returns another provision, or another Act's provision, is a store
      // defect: refuse it here rather than compare against the wrong text.
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
