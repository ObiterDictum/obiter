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
  createPostgresLegalAuthorityReadStore,
  findStoredAuthorityIdsByNeutralCitation,
  MalformedStoredRecordError,
  selectAuthorityCarriers,
  type StoredAuthorityCarrier,
} from './routes/legal-search/source-store'
import {
  getLegislationDocument,
  getLegislationProvision,
  legislationProvisionPathExists,
  resolveStoredProvisionPath,
} from './routes/legal-search/legislation-store'

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

function storeUnavailable(error: StoreReadError): AuthorityExistenceOutcome {
  const code =
    error.cause instanceof Error && 'code' in error.cause
      ? String(error.cause.code)
      : null
  console.warn('Authority existence store read failed', {
    category: error.category,
    code,
  })
  return { outcome: 'unavailable', reason: error.category }
}

async function lookupCaseLaw(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'case_law' }>,
): Promise<AuthorityExistenceOutcome> {
  try {
    const ids = await readStore(() =>
      findStoredAuthorityIdsByNeutralCitation(pool, citation.neutralCitation),
    )
    if (ids.length === 0) return { outcome: 'not_held', missing: 'authority' }

    const store = createPostgresLegalAuthorityReadStore(pool)
    const carriers: StoredAuthorityCarrier[] = []
    for (const id of ids) {
      const record = await readStore(() => store.get(id))
      if (record) {
        carriers.push({
          id: record.summary.id,
          withdrawn: record.withdrawn != null,
        })
      }
    }

    const selection = selectAuthorityCarriers(carriers)
    switch (selection.kind) {
      case 'none':
        return { outcome: 'not_held', missing: 'authority' }
      case 'ambiguous':
        return { outcome: 'ambiguous' }
      case 'no_live':
        return { outcome: 'unavailable', reason: 'source_withdrawn' }
      case 'single_live':
        if (selection.id !== citation.sourceId) {
          return { outcome: 'unavailable', reason: 'identity_mismatch' }
        }
        return {
          outcome: 'held',
          evidence: [
            {
              sourceType: 'judgment',
              granularity: 'document',
              sourceId: selection.id,
            },
          ],
        }
    }
  } catch (error) {
    if (!(error instanceof StoreReadError)) throw error
    return storeUnavailable(error)
  }
}

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
        return { outcome: 'unavailable', reason: 'citation_underspecified' }
    }
  } catch (error) {
    if (!(error instanceof StoreReadError)) throw error
    return storeUnavailable(error)
  }
}
