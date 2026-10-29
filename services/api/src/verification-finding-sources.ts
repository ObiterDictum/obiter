import type { Pool } from 'pg'
import type { EvidenceReference } from '@obiter/verification-core'

export type StoredFindingSource = {
  url: string
  title: string | null
  neutralCitation: string | null
}

type Queryable = Pick<Pool, 'query'>

export function findingSourceKey(reference: EvidenceReference) {
  const family =
    reference.sourceType === 'judgment' ? 'judgment' : 'legislation'
  return `${family}:${reference.sourceId}`
}

export async function loadFindingSources(
  queryable: Queryable,
  findings: readonly { evidence: EvidenceReference[] }[],
): Promise<Map<string, StoredFindingSource>> {
  const references = findings.flatMap((finding) => finding.evidence)
  const judgmentIds = [
    ...new Set(
      references
        .filter((reference) => reference.sourceType === 'judgment')
        .map((reference) => reference.sourceId),
    ),
  ]
  const actIdentities = [
    ...new Set(
      references
        .filter((reference) => reference.sourceType !== 'judgment')
        .map((reference) => reference.sourceId),
    ),
  ]
  const sources = new Map<string, StoredFindingSource>()
  if (judgmentIds.length > 0) {
    const result = await queryable.query<{
      id: string
      url: string
      title: string | null
      neutral_citation: string | null
    }>(
      `select document_id as id,
              coalesce(summary_json->>'sourceUrl', source_uri) as url,
              summary_json->>'title' as title,
              summary_json->>'neutralCitation' as neutral_citation
       from legal_source_documents
       where document_id = any($1::text[])`,
      [judgmentIds],
    )
    for (const row of result.rows) {
      sources.set(`judgment:${row.id}`, {
        url: row.url,
        title: row.title,
        neutralCitation: row.neutral_citation,
      })
    }
  }
  if (actIdentities.length > 0) {
    const result = await queryable.query<{ id: string; url: string }>(
      `select identity as id, source_url as url
       from legislation_documents
       where identity = any($1::text[])`,
      [actIdentities],
    )
    for (const row of result.rows) {
      sources.set(`legislation:${row.id}`, {
        url: row.url,
        title: null,
        neutralCitation: null,
      })
    }
  }
  return sources
}
