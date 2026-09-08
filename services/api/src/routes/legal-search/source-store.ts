import type { Pool, QueryResultRow } from 'pg'
import { LegalAuthoritySchema, type LegalAuthority } from '@obiter/legal-schema'

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

export function createPostgresLegalAuthoritySourceStore(
  pool: Pool,
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

      return toStoredLegalAuthorityRecord(result.rows[0])
    },
  }
}

function toStoredLegalAuthorityRecord(
  row?: LegalAuthoritySourceRow,
): StoredLegalAuthorityRecord | null {
  if (!row) return null

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
