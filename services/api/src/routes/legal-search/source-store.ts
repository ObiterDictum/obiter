import type { Pool, QueryResultRow } from 'pg'
import { LegalAuthoritySchema, type LegalAuthority } from '@obiter/legal-schema'
import {
  containsEveryQueryTerm,
  rankLegalSearchHitsByExactMatch,
  type LegalSearchFilters,
} from '@obiter/search-client'

export interface ProviderSourceMetadata {
  documentUri: string
  sourceUri: string
  xmlUri: string | null
  pdfUri: string | null
  contentHash: string
  rawAtomEntry: string
  rawDocumentHtml?: string
}

export interface StoredLegalAuthorityRecord {
  summary: LegalAuthority
  document?: LegalAuthority
  provider: ProviderSourceMetadata
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
  search(query: string, filters: LegalSearchFilters): Promise<LegalAuthority[]>
}

const storedSearchTimeoutMs = 350
const sourceStoreStatementTimeout = `${storedSearchTimeoutMs}ms`
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
      })
    },
    async get(documentId: string) {
      return records.get(documentId) ?? null
    },
    async search(query: string, filters: LegalSearchFilters) {
      const normalizedQuery = normalizeSearchText(query)
      const dateOrderedMatches = Array.from(records.values())
        .map((record) => record.document ?? record.summary)
        .filter((document) =>
          documentMatchesSearch(document, normalizedQuery, filters),
        )
        .sort((left, right) =>
          right.dateDecided.localeCompare(left.dateDecided),
        )

      return rankLegalSearchHitsByExactMatch(dateOrderedMatches, query).slice(
        0,
        10,
      )
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
    async search(query, filters) {
      const normalizedQuery = normalizeSearchText(query)
      const client = await pool.connect()

      try {
        await client.query('begin')
        await client.query('select set_config($1, $2, true)', [
          'statement_timeout',
          sourceStoreStatementTimeout,
        ])

        const result = await client.query<LegalAuthoritySourceRow>(
          `
            select summary_json, document_json, provider_json
            from legal_source_documents
            where ($1::text is null or summary_json->>'court' = $1)
              and ($2::text is null or summary_json->>'jurisdiction' = $2)
              and ($3::text is null or summary_json->>'sourceType' = $3)
              and ($4::text is null or summary_json->>'dateDecided' >= $4)
              and ($5::text is null or summary_json->>'dateDecided' <= $5)
              and (
                $6::text = ''
                or search_vector @@ websearch_to_tsquery('english', $6)
                or regexp_replace(lower(trim(coalesce(summary_json->>'id', ''))), '\\s+', ' ', 'g') = $7
                or regexp_replace(lower(trim(coalesce(summary_json->>'neutralCitation', ''))), '\\s+', ' ', 'g') = $7
                or regexp_replace(lower(trim(coalesce(summary_json->>'title', ''))), '\\s+', ' ', 'g') = $7
              )
            order by
              case
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'id', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 3
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'neutralCitation', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 2
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'title', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 1
                else 0
              end desc,
              ts_rank_cd(search_vector, websearch_to_tsquery('english', $6)) desc,
              summary_json->>'dateDecided' desc
            limit 10
          `,
          [
            filters.court ?? null,
            filters.jurisdiction ?? null,
            filters.sourceType ?? null,
            filters.dateFrom ?? null,
            filters.dateTo ?? null,
            normalizedQuery,
            normalizedQuery,
          ],
        )
        await client.query('commit')

        const documents = result.rows
          .map((row) => {
            const record = toStoredLegalAuthorityRecord(row)
            return record?.document ?? record?.summary
          })
          .filter((document): document is LegalAuthority => Boolean(document))

        return rankLegalSearchHitsByExactMatch(documents, query)
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
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

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function documentMatchesSearch(
  document: LegalAuthority,
  normalizedQuery: string,
  filters: LegalSearchFilters,
) {
  if (filters.court && document.court !== filters.court) return false
  if (filters.jurisdiction && document.jurisdiction !== filters.jurisdiction)
    return false
  if (filters.sourceType && document.sourceType !== filters.sourceType)
    return false
  if (filters.dateFrom && document.dateDecided < filters.dateFrom) return false
  if (filters.dateTo && document.dateDecided > filters.dateTo) return false
  if (!normalizedQuery) return true

  const haystack = [
    document.id,
    document.title,
    document.neutralCitation,
    ...(document.paragraphs?.map((paragraph) => paragraph.text) ?? []),
  ].join(' ')

  return containsEveryQueryTerm(haystack, normalizedQuery)
}
