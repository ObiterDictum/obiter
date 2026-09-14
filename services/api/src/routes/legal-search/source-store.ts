import type { Pool, QueryResultRow } from 'pg'
import { LegalAuthoritySchema, type LegalAuthority } from '@obiter/legal-schema'
import { normalizeCitationValue } from '@obiter/search-client'

// Defined alongside the provider that produces it, and re-exported here so
// storage callers keep importing it from the store they already use.
export type { ProviderSourceMetadata } from '@obiter/legal-source-provider'
import type { ProviderSourceMetadata } from '@obiter/legal-source-provider'
import {
  readWithdrawnInfo,
  type WithdrawnInfo,
} from '@obiter/legal-source-provider'

export type { WithdrawnInfo }

export interface StoredLegalAuthorityRecord {
  summary: LegalAuthority
  document?: LegalAuthority
  provider: ProviderSourceMetadata
  /** Set when the row is marked withdrawn upstream. Search excludes these
   * from default results; the document route surfaces a banner instead. */
  withdrawn?: WithdrawnInfo | null
}

/**
 * One stored carrier of a neutral citation: the document id and whether the row
 * carries upstream withdrawal evidence. It is the whole input the live/withdrawn
 * rule needs, so resolution and the existence check classify the same shape.
 */
export interface StoredAuthorityCarrier {
  id: string
  withdrawn: boolean
}

/**
 * What a set of stored carriers means for identity selection. It states which
 * identities exist and which are trustworthy, and nothing about whether the
 * authority is held: that stays the existence check's decision.
 */
export type AuthorityCarrierSelection =
  | { kind: 'none' }
  | { kind: 'single_live'; id: string }
  | { kind: 'ambiguous' }
  | { kind: 'no_live'; ids: string[] }

/**
 * The one live/withdrawn carrier rule, shared by V2 (authority existence) and V3
 * (citation resolution) so the two adjacent stages cannot disagree about the
 * same store state again.
 *
 * One live carrier is `single_live` whatever withdrawn history sits beside it: a
 * withdrawn row is a source that was once minted and is no longer trustworthy,
 * not a second candidate identity, so a live source plus withdrawn duplicates is
 * not ambiguous. Two or more live carriers are `ambiguous` and no carrier wins by
 * arriving first. With no live carrier, every withdrawn id is returned so the
 * caller decides; a single withdrawn id is still a usable identity, while more
 * than one is not, and that gap is a documented V1 limitation, not a reason to
 * pick one.
 *
 * `document_id` is the store's primary key, so a duplicate id is not reachable
 * from the store; it is deduped here so a direct caller cannot make the outcome
 * depend on how many times it passed the same id, and a conflicting duplicate is
 * treated as withdrawn, which fails closed rather than clearing on it.
 */
export function selectAuthorityCarriers(
  carriers: readonly StoredAuthorityCarrier[],
): AuthorityCarrierSelection {
  const byId = new Map<string, boolean>()
  for (const carrier of carriers) {
    byId.set(carrier.id, (byId.get(carrier.id) ?? false) || carrier.withdrawn)
  }
  const live = [...byId.entries()].filter(([, withdrawn]) => !withdrawn)
  if (live.length > 1) return { kind: 'ambiguous' }
  const [only] = live
  if (only) return { kind: 'single_live', id: only[0] }
  const withdrawn = [...byId.keys()].sort()
  if (withdrawn.length === 0) return { kind: 'none' }
  return { kind: 'no_live', ids: withdrawn }
}

export interface LegalAuthoritySourceStore {
  upsertSummary(
    summary: LegalAuthority,
    provider: ProviderSourceMetadata,
  ): Promise<void>
  upsertDocument(
    document: LegalAuthority,
    provider: ProviderSourceMetadata,
  ): Promise<void>
  get(documentId: string): Promise<StoredLegalAuthorityRecord | null>
}

const foregroundSourceRecordLimit = 100

export function createInMemoryLegalAuthoritySourceStore(): LegalAuthoritySourceStore {
  const records = new Map<string, StoredLegalAuthorityRecord>()

  return {
    async upsertSummary(
      summary: LegalAuthority,
      provider: ProviderSourceMetadata,
    ) {
      const existing = records.get(summary.id)
      records.set(summary.id, {
        summary,
        document: existing?.document,
        provider: {
          ...existing?.provider,
          ...provider,
        },
        // Mirror the Postgres merge upsert, which preserves the withdrawn
        // flag across re-ingests: a fresh provider payload never carries the
        // flag, so dropping it here would silently resurrect withdrawals.
        withdrawn: existing?.withdrawn,
      })
    },
    async upsertDocument(
      document: LegalAuthority,
      provider: ProviderSourceMetadata,
    ) {
      const existing = records.get(document.id)
      records.set(document.id, {
        summary: existing?.summary ?? toAuthoritySummary(document),
        document,
        provider: {
          ...existing?.provider,
          ...provider,
        },
        withdrawn: existing?.withdrawn,
      })
    },
    async get(documentId: string) {
      return records.get(documentId) ?? null
    },
  }
}

interface LegalAuthoritySourceRow extends QueryResultRow {
  summary_json: unknown
  document_json: unknown | null
  provider_json: ProviderSourceMetadata
}

/**
 * A stored row whose JSON is valid JSON but not a legal-source record. It is a
 * store-boundary failure with its own category so the caller can tell a
 * schema-invalid row from a database that is unavailable, without the detail
 * ever reaching a finding.
 */
export class MalformedStoredRecordError extends Error {
  constructor(documentId: string, options?: { cause?: unknown }) {
    super(
      `Stored legal source record ${documentId} failed schema validation.`,
      options,
    )
    this.name = 'MalformedStoredRecordError'
  }
}

export function createPostgresLegalAuthoritySourceStore(
  pool: Pick<Pool, 'query'>,
): LegalAuthoritySourceStore {
  return {
    async upsertSummary(summary, provider) {
      await pool.query(
        `
          insert into legal_source_documents (
            document_id,
            summary_json,
            provider_json,
            content_hash,
            source_uri,
            xml_uri,
            pdf_uri,
            updated_at
          )
          values ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, now())
          on conflict (document_id) do update set
            summary_json = excluded.summary_json,
            provider_json = legal_source_documents.provider_json || excluded.provider_json,
            content_hash = excluded.content_hash,
            source_uri = excluded.source_uri,
            xml_uri = excluded.xml_uri,
            pdf_uri = excluded.pdf_uri,
            updated_at = now()
        `,
        [
          summary.id,
          JSON.stringify(summary),
          JSON.stringify(provider),
          provider.contentHash,
          provider.sourceUri,
          provider.xmlUri,
          provider.pdfUri,
        ],
      )
    },
    async upsertDocument(document, provider) {
      const summary = toAuthoritySummary(document)
      await pool.query(
        `
          insert into legal_source_documents (
            document_id,
            summary_json,
            document_json,
            provider_json,
            content_hash,
            source_uri,
            xml_uri,
            pdf_uri,
            updated_at
          )
          values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7, $8, now())
          on conflict (document_id) do update set
            summary_json = excluded.summary_json,
            document_json = excluded.document_json,
            provider_json = legal_source_documents.provider_json || excluded.provider_json,
            content_hash = excluded.content_hash,
            source_uri = excluded.source_uri,
            xml_uri = excluded.xml_uri,
            pdf_uri = excluded.pdf_uri,
            updated_at = now()
        `,
        [
          document.id,
          JSON.stringify(summary),
          JSON.stringify(document),
          JSON.stringify(provider),
          provider.contentHash,
          provider.sourceUri,
          provider.xmlUri,
          provider.pdfUri,
        ],
      )
    },
    async get(documentId) {
      const result = await pool.query<LegalAuthoritySourceRow>(
        `
          select summary_json, document_json, provider_json
          from legal_source_documents
          where document_id = $1
        `,
        [documentId],
      )

      return toStoredLegalAuthorityRecord(result.rows[0], documentId)
    },
  }
}

function toStoredLegalAuthorityRecord(
  row: LegalAuthoritySourceRow | undefined,
  documentId: string,
): StoredLegalAuthorityRecord | null {
  if (!row) return null

  try {
    const summary = LegalAuthoritySchema.parse(row.summary_json)
    const document = row.document_json
      ? LegalAuthoritySchema.parse(row.document_json)
      : undefined

    return {
      summary,
      document,
      provider: row.provider_json,
      withdrawn: readWithdrawnInfo(row.provider_json),
    }
  } catch (error) {
    throw new MalformedStoredRecordError(documentId, { cause: error })
  }
}

interface StoredAuthorityCitationRow extends QueryResultRow {
  documentId: string
  neutralCitation: string | null
  providerJson: unknown
}

/**
 * Stored authority carriers whose neutral citation canonically equals one of
 * `neutralCitations`, keyed by the normalized form of the citation they match.
 * The record is Postgres; the fold is search-client's `normalizeCitationValue`,
 * the same one the search path compares with, so an exact citation lookup
 * cannot drift from search's notion of equality.
 *
 * The query transfers the citation projection and the provider block only,
 * never document bodies, and it pushes the citation's year into SQL: the fold
 * never changes the year, so a row whose citation does not contain it cannot
 * match, and rejecting those rows in the database removes the bulk of the
 * transfer (91-97% on the lane corpus, year-dependent). The database predicate
 * is a superset of the fold (a `like` can match the digits anywhere), so the
 * exact comparison still runs in Node and SQL is never trusted for equality.
 *
 * The API is a batch: a caller with many citations pays one query for the year
 * set instead of one full-table transfer per citation, which is what V3's
 * per-document caller needs. Rows are ordered by `document_id` and each carrier
 * list is sorted, so the result does not depend on table or scan order. The
 * withdrawn flag is carried too: it is the difference between a live source and
 * a withdrawal, and {@link selectAuthorityCarriers} is the one rule that reads
 * it.
 */
export async function findStoredAuthorityCarriersByNeutralCitations(
  pool: Pick<Pool, 'query'>,
  neutralCitations: string[],
): Promise<Map<string, StoredAuthorityCarrier[]>> {
  const matches = new Map<string, StoredAuthorityCarrier[]>()
  const years = new Set<string>()
  let includesUnparseableYear = false
  for (const neutralCitation of neutralCitations) {
    const normalized = normalizeCitationValue(neutralCitation)
    if (!normalized) continue
    if (!matches.has(normalized)) matches.set(normalized, [])
    const year = neutralCitation.match(/\[(\d{4})\]/)?.[1] ?? null
    if (year) years.add(year)
    else includesUnparseableYear = true
  }
  if (matches.size === 0) return matches

  const rows: StoredAuthorityCitationRow[] = []
  if (years.size > 0) {
    const result = await pool.query<StoredAuthorityCitationRow>(
      `select document_id as "documentId",
              summary_json->>'neutralCitation' as "neutralCitation",
              provider_json as "providerJson"
         from legal_source_documents
        where summary_json->>'neutralCitation' is not null
          and summary_json->>'neutralCitation' like any($1::text[])
        order by document_id`,
      [[...years].map((year) => `%${year}%`)],
    )
    rows.push(...result.rows)
  }
  if (includesUnparseableYear) {
    // A citation with no parsable year cannot use the year predicate, so it
    // scans the citation projection. That is the pre-existing cost for that
    // input, not the common path.
    const result = await pool.query<StoredAuthorityCitationRow>(
      `select document_id as "documentId",
              summary_json->>'neutralCitation' as "neutralCitation",
              provider_json as "providerJson"
         from legal_source_documents
        where summary_json->>'neutralCitation' is not null
        order by document_id`,
    )
    rows.push(...result.rows)
  }

  for (const row of rows) {
    if (!row.neutralCitation) continue
    const carriers = matches.get(normalizeCitationValue(row.neutralCitation))
    if (!carriers || carriers.some((carrier) => carrier.id === row.documentId))
      continue
    carriers.push({
      id: row.documentId,
      withdrawn: readWithdrawnInfo(row.providerJson) !== null,
    })
  }
  for (const carriers of matches.values()) {
    carriers.sort((left, right) => left.id.localeCompare(right.id))
  }
  return matches
}

/**
 * The id-only projection of {@link findStoredAuthorityCarriersByNeutralCitations},
 * for a caller that needs the stored ids and makes its own record reads. The
 * batch carrier function is the one implementation; this narrows it.
 */
export async function findStoredAuthorityIdsByNeutralCitations(
  pool: Pick<Pool, 'query'>,
  neutralCitations: string[],
): Promise<Map<string, string[]>> {
  const carriers = await findStoredAuthorityCarriersByNeutralCitations(
    pool,
    neutralCitations,
  )
  const ids = new Map<string, string[]>()
  for (const [normalized, match] of carriers) {
    ids.set(
      normalized,
      match.map((carrier) => carrier.id),
    )
  }
  return ids
}

/**
 * The single-citation form of {@link findStoredAuthorityIdsByNeutralCitations}.
 * A caller with several citations should use the batch function: the year
 * predicate is shared, so one query covers all of them instead of one
 * full-table transfer per citation.
 */
export async function findStoredAuthorityIdsByNeutralCitation(
  pool: Pick<Pool, 'query'>,
  neutralCitation: string,
): Promise<string[]> {
  const normalized = normalizeCitationValue(neutralCitation)
  if (!normalized) return []
  const matches = await findStoredAuthorityIdsByNeutralCitations(pool, [
    neutralCitation,
  ])
  return matches.get(normalized) ?? []
}

export function toAuthoritySummary(document: LegalAuthority): LegalAuthority {
  return {
    id: document.id,
    title: document.title,
    neutralCitation: document.neutralCitation,
    court: document.court,
    jurisdiction: document.jurisdiction,
    dateDecided: document.dateDecided,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl,
  }
}

export function rememberForegroundSourceRecord(
  records: Map<string, StoredLegalAuthorityRecord>,
  summary: LegalAuthority,
  provider: ProviderSourceMetadata,
  document?: LegalAuthority,
) {
  const existing = records.get(summary.id)
  records.delete(summary.id)
  records.set(summary.id, {
    summary,
    document: document ?? existing?.document,
    provider: {
      ...existing?.provider,
      ...provider,
    },
  })

  const oldestRecordId = records.keys().next().value
  if (records.size > foregroundSourceRecordLimit && oldestRecordId) {
    records.delete(oldestRecordId)
  }
}
