import type { Pool } from 'pg'
import {
  decideAuthorityExistence,
  type AuthorityExistenceOutcome,
  type CitationInput,
  type NormalizedCitation,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import {
  createPostgresLegalAuthoritySourceStore,
  findStoredAuthorityIdsByNeutralCitation,
  MalformedStoredRecordError,
  type StoredLegalAuthorityRecord,
} from './routes/legal-search/source-store'
import {
  getLegislationDocument,
  getLegislationProvision,
  legislationProvisionPathExists,
  resolveStoredProvisionPath,
} from './routes/legal-search/legislation-store'

/**
 * The authority-existence store boundary. It reads Obiter's stored public
 * legal-source record and returns what it found; it makes no truth-table
 * decision, which lives in `@obiter/verification-core`. Nothing here reads
 * matter data, calls an external provider, or writes: a check is a read of the
 * public corpus.
 *
 * A store failure is reported as `unavailable`, never swallowed into an
 * absence. The failure keeps its category, so a database that is down
 * (`store_error`) and a row that fails its schema (`malformed_record`) are
 * distinguishable by an operational caller even though both make the check
 * inconclusive. A withdrawn source is `unavailable` too: the row exists but is
 * not a trustworthy current source, which is different from not holding it at
 * all.
 */
export async function lookupAuthorityExistence(
  pool: Pick<Pool, 'query'>,
  citation: NormalizedCitation,
): Promise<AuthorityExistenceOutcome> {
  switch (citation.kind) {
    case 'case_law':
      return lookupCaseLaw(pool, citation)
    case 'legislation':
      return lookupLegislation(
        pool,
        citation.documentIdentity,
        citation.labelPath,
      )
    case 'unresolved':
    case 'not_checked':
      return { outcome: 'skipped' }
  }
}

/**
 * One authority-existence finding: the store lookup for a resolved citation,
 * then the pure decision. A citation that did not resolve never reaches the
 * store, so an unresolved or unrun citation cannot accidentally acquire a
 * store verdict.
 */
export async function checkAuthorityExistence(
  pool: Pick<Pool, 'query'>,
  input: {
    subject: VerificationSubject
    citation: CitationInput
    normalizedCitation: NormalizedCitation
  },
): Promise<VerificationFinding> {
  const resolved =
    input.normalizedCitation.kind === 'case_law' ||
    input.normalizedCitation.kind === 'legislation'
  const outcome: AuthorityExistenceOutcome = resolved
    ? await lookupAuthorityExistence(pool, input.normalizedCitation)
    : { outcome: 'skipped' }
  return decideAuthorityExistence({ ...input, outcome })
}

/**
 * A store read that failed. The category is set only at the store boundary, so
 * a programmer error in the check's own logic is a different error type and is
 * never converted into an expected store failure.
 */
type StoreFailureCategory = 'store_error' | 'malformed_record'

class StoreReadError extends Error {
  constructor(
    readonly category: StoreFailureCategory,
    options?: { cause?: unknown },
  ) {
    super(`Store read failed: ${category}`, options)
    this.name = 'StoreReadError'
  }
}

/**
 * Runs one stored read. Only a failure raised by the store boundary is
 * classified; anything else propagates, so a bug in this file cannot read as a
 * database outage.
 */
async function readStore<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw new StoreReadError(
      error instanceof MalformedStoredRecordError
        ? 'malformed_record'
        : 'store_error',
      { cause: error },
    )
  }
}

/**
 * The only place a store failure becomes a lookup outcome, so the diagnostic
 * exists exactly once. It records the category and the error message — never
 * the citation, matter text or any other input.
 */
function storeUnavailable(error: StoreReadError): AuthorityExistenceOutcome {
  const message = error.cause instanceof Error ? error.cause.message : null
  console.warn('Authority existence store read failed', {
    category: error.category,
    message,
  })
  return { outcome: 'unavailable', reason: error.category }
}

/**
 * Exact neutral-citation match only. A held judgment is evidenced by the
 * stored document itself, not by an arbitrary paragraph of it: existence is a
 * claim about the document, so a judgment whose paragraph array is empty still
 * clears truthfully. A single match whose stored id disagrees with the
 * citation's resolved source id is an inconsistent identity, not a held
 * authority.
 */
async function lookupCaseLaw(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'case_law' }>,
): Promise<AuthorityExistenceOutcome> {
  try {
    const ids = await readStore(() =>
      findStoredAuthorityIdsByNeutralCitation(pool, citation.neutralCitation),
    )
    if (ids.length === 0) return { outcome: 'not_held', missing: 'authority' }

    const store = createPostgresLegalAuthoritySourceStore(pool)
    const records: StoredLegalAuthorityRecord[] = []
    for (const id of ids) {
      const record = await readStore(() => store.get(id))
      if (record) records.push(record)
    }

    const live = records.filter((record) => !record.withdrawn)
    const [only, ...rest] = live
    if (!only) {
      return records.length > 0
        ? { outcome: 'unavailable', reason: 'source_withdrawn' }
        : { outcome: 'not_held', missing: 'authority' }
    }
    if (rest.length > 0) return { outcome: 'ambiguous' }
    if (only.summary.id !== citation.sourceId) {
      return { outcome: 'unavailable', reason: 'identity_mismatch' }
    }
    return {
      outcome: 'held',
      evidence: [
        {
          sourceType: 'judgment',
          granularity: 'document',
          sourceId: only.summary.id,
        },
      ],
    }
  } catch (error) {
    if (!(error instanceof StoreReadError)) throw error
    return storeUnavailable(error)
  }
}

/**
 * A held Act is evidenced by the document identity itself, so an Act that
 * holds no provisions still clears truthfully. A provision citation is
 * resolved through the shared single-schedule resolver, the same one the
 * serving path uses, so a stored `schedule/paragraph/N` answers a citation
 * for `schedule/1/paragraph/N` instead of reading as not held.
 */
async function lookupLegislation(
  pool: Pick<Pool, 'query'>,
  documentIdentity: string,
  labelPath: string | null,
): Promise<AuthorityExistenceOutcome> {
  try {
    const document = await readStore(() =>
      getLegislationDocument(pool, documentIdentity),
    )
    if (!document) return { outcome: 'not_held', missing: 'authority' }

    if (labelPath === null) {
      return {
        outcome: 'held',
        evidence: [
          {
            sourceType: 'legislation_document',
            granularity: 'document',
            sourceId: documentIdentity,
          },
        ],
      }
    }

    const resolution = await resolveStoredProvisionPath(
      {
        getProvision: (provisionId) =>
          readStore(() => getLegislationProvision(pool, provisionId)),
        pathExists: (identity, path) =>
          readStore(() => legislationProvisionPathExists(pool, identity, path)),
      },
      documentIdentity,
      labelPath,
    )
    switch (resolution.status) {
      case 'held':
        return {
          outcome: 'held',
          evidence: [
            {
              sourceType: 'legislation_provision',
              granularity: 'fragment',
              sourceId: documentIdentity,
              labelPath: resolution.provision.labelPath,
            },
          ],
        }
      case 'missing':
        return { outcome: 'not_held', missing: 'provision' }
      case 'underspecified':
        // The Act is held but the citation names no schedule and the store
        // cannot resolve it without guessing. That is a citation problem, not
        // an absent provision, so it must not read as not held.
        return { outcome: 'unavailable', reason: 'citation_underspecified' }
    }
  } catch (error) {
    if (!(error instanceof StoreReadError)) throw error
    return storeUnavailable(error)
  }
}
