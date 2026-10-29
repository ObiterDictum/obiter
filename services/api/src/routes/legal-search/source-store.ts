import type { Pool, QueryResultRow } from 'pg'
import {
  CaseLawJudgeSchema,
  CaseLawSummarySchema,
  LegalAuthoritySchema,
  type CaseLawJudge,
  type CaseLawSummary,
  type LegalAuthority,
} from '@obiter/legal-schema'
import { z } from 'zod'
import { normalizeCitationValue } from '@obiter/search-client'

import type { ProviderSourceMetadata } from '@obiter/legal-source-provider'
import {
  readWithdrawnInfo,
  type WithdrawnInfo,
} from '@obiter/legal-source-provider'

export interface StoredLegalAuthorityRecord {
  summary: LegalAuthority
  document?: LegalAuthority
  provider: ProviderSourceMetadata
  judges?: CaseLawJudge[]
  publishedSummary?: CaseLawSummary | null
  withdrawn?: WithdrawnInfo | null
}

export interface StoredAuthorityCarrier {
  id: string
  withdrawn: boolean
}

export type AuthorityCarrierSelection =
  | { kind: 'none' }
  | { kind: 'single_live'; id: string }
  | { kind: 'ambiguous' }
  | { kind: 'no_live'; ids: string[] }

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

interface AuthorityWriteResult {
  indexable: boolean
}

export interface LegalAuthorityReadStore {
  get(documentId: string): Promise<StoredLegalAuthorityRecord | null>
}

interface LegalAuthorityWriteStore {
  upsertSummary(
    summary: LegalAuthority,
    provider: ProviderSourceMetadata,
  ): Promise<AuthorityWriteResult>
  upsertDocument(
    document: LegalAuthority,
    provider: ProviderSourceMetadata,
  ): Promise<AuthorityWriteResult>
}

export interface LegalAuthoritySourceStore
  extends LegalAuthorityReadStore, LegalAuthorityWriteStore {}

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
        withdrawn: existing?.withdrawn,
      })

      return { indexable: !existing?.withdrawn }
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

      return { indexable: !existing?.withdrawn }
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
  judges: unknown
  summary: unknown
}

interface LegalAuthorityWriteRow extends QueryResultRow {
  indexable: boolean
}

export class MalformedStoredRecordError extends Error {
  constructor(documentId: string, options?: { cause?: unknown }) {
    super(
      `Stored legal source record ${documentId} failed schema validation.`,
      options,
    )
    this.name = 'MalformedStoredRecordError'
  }
}

export function createPostgresLegalAuthorityReadStore(
  pool: Pick<Pool, 'query'>,
): LegalAuthorityReadStore {
  return {
    async get(documentId) {
      const result = await pool.query<LegalAuthoritySourceRow>(
        `
          select summary_json, document_json, provider_json, judges, summary
          from legal_source_documents
          where document_id = $1
        `,
        [documentId],
      )

      return toStoredLegalAuthorityRecord(result.rows[0], documentId)
    },
  }
}

export function createPostgresLegalAuthorityWriteStore(
  pool: Pick<Pool, 'query'>,
): LegalAuthorityWriteStore {
  return {
    async upsertSummary(summary, provider) {
      const result = await pool.query<LegalAuthorityWriteRow>(
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
          returning legal_source_documents.provider_json->>'withdrawn' is null as indexable
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

      return { indexable: result.rows[0]?.indexable ?? false }
    },
    async upsertDocument(document, provider) {
      const summary = toAuthoritySummary(document)
      const result = await pool.query<LegalAuthorityWriteRow>(
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
          returning legal_source_documents.provider_json->>'withdrawn' is null as indexable
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

      return { indexable: result.rows[0]?.indexable ?? false }
    },
  }
}

export function createPostgresLegalAuthoritySourceStore(
  pool: Pick<Pool, 'query'>,
): LegalAuthoritySourceStore {
  return {
    ...createPostgresLegalAuthorityReadStore(pool),
    ...createPostgresLegalAuthorityWriteStore(pool),
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
      judges: z.array(CaseLawJudgeSchema).parse(row.judges ?? []),
      publishedSummary: row.summary
        ? CaseLawSummarySchema.parse(row.summary)
        : null,
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

function toAuthoritySummary(document: LegalAuthority): LegalAuthority {
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
