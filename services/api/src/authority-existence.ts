import type { Pool } from 'pg'
import {
  decideAuthorityExistence,
  legislationLabelPathSchema,
  type AuthorityExistenceOutcome,
  type CitationInput,
  type EvidenceReference,
  type NormalizedCitation,
  type VerificationFinding,
  type VerificationSubject,
} from '@obiter/verification-core'
import {
  createPostgresLegalAuthoritySourceStore,
  findStoredAuthorityIdsByNeutralCitation,
  type StoredLegalAuthorityRecord,
} from './routes/legal-search/source-store'
import {
  getFirstLegislationProvisionLabelPath,
  getLegislationDocument,
  getLegislationProvision,
} from './routes/legal-search/legislation-store'

/**
 * The authority-existence store boundary. It reads Obiter's stored public
 * legal-source record and returns what it found; it makes no truth-table
 * decision, which lives in `@obiter/verification-core`. Nothing here reads
 * matter data, calls an external provider, or writes: a check is a read of the
 * public corpus.
 *
 * A store failure is reported as `unavailable`, never swallowed into an
 * absence. A withdrawn source is reported as `unavailable` too: the row exists
 * but is not a trustworthy current source, which is different from not holding
 * it at all.
 */
export async function lookupAuthorityExistence(
  pool: Pick<Pool, 'query'>,
  citation: NormalizedCitation,
): Promise<AuthorityExistenceOutcome> {
  try {
    switch (citation.kind) {
      case 'case_law':
        return await lookupCaseLaw(pool, citation)
      case 'legislation':
        return await lookupLegislation(
          pool,
          citation.documentIdentity,
          citation.labelPath,
        )
      case 'unresolved':
      case 'not_checked':
        return { outcome: 'skipped' }
    }
  } catch {
    return { outcome: 'unavailable', reason: 'store_error' }
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
 * Exact neutral-citation match only. A held judgment is evidenced by its own
 * first paragraph; a source whose paragraph array is empty is held but has no
 * addressable evidence, and the decision withholds a clear for it. A single
 * match whose stored id disagrees with the citation's resolved source id is
 * an inconsistent identity, not a held authority.
 */
async function lookupCaseLaw(
  pool: Pick<Pool, 'query'>,
  citation: Extract<NormalizedCitation, { kind: 'case_law' }>,
): Promise<AuthorityExistenceOutcome> {
  const ids = await findStoredAuthorityIdsByNeutralCitation(
    pool,
    citation.neutralCitation,
  )
  if (ids.length === 0) return { outcome: 'not_held', missing: 'authority' }

  const store = createPostgresLegalAuthoritySourceStore(pool)
  const records: StoredLegalAuthorityRecord[] = []
  for (const id of ids) {
    const record = await store.get(id)
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
  return { outcome: 'held', evidence: judgmentEvidence(only) }
}

function judgmentEvidence(
  record: StoredLegalAuthorityRecord,
): EvidenceReference[] {
  const first = record.document?.paragraphs?.[0]
  if (!first) return []
  return [
    {
      sourceType: 'judgment',
      sourceId: record.summary.id,
      ordinal: 1,
      paragraphNumber: first.paragraphNumber,
    },
  ]
}

async function lookupLegislation(
  pool: Pick<Pool, 'query'>,
  documentIdentity: string,
  labelPath: string | null,
): Promise<AuthorityExistenceOutcome> {
  const document = await getLegislationDocument(pool, documentIdentity)
  if (!document) return { outcome: 'not_held', missing: 'authority' }

  if (labelPath === null) {
    const firstProvision = await getFirstLegislationProvisionLabelPath(
      pool,
      documentIdentity,
    )
    const parsed = firstProvision
      ? legislationLabelPathSchema.safeParse(firstProvision)
      : null
    if (!parsed?.success) return { outcome: 'held', evidence: [] }
    return {
      outcome: 'held',
      evidence: [
        {
          sourceType: 'legislation_provision',
          sourceId: documentIdentity,
          labelPath: parsed.data,
        },
      ],
    }
  }

  const provision = await getLegislationProvision(
    pool,
    `${documentIdentity}/${labelPath}`,
  )
  if (!provision) return { outcome: 'not_held', missing: 'provision' }
  return {
    outcome: 'held',
    evidence: [
      {
        sourceType: 'legislation_provision',
        sourceId: documentIdentity,
        labelPath,
      },
    ],
  }
}
