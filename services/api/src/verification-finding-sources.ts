import type { Pool } from 'pg'
import type { EvidenceReference } from '@obiter/verification-core'

/**
 * The stored source a finding's evidence points at. It carries only what the
 * store already holds: the upstream URL the source is named from, and the
 * metadata needed to build stage 7's source page and land on a paragraph.
 * Nothing here is derived from matter text.
 */
export type StoredFindingSource = {
  url: string
  title: string | null
  neutralCitation: string | null
}

type Queryable = Pick<Pool, 'query'>

/** Judgment ids and Act identities share one map, so the key names the family
 * and two stores can never make one lookup answer for the other. */
export function findingSourceKey(reference: EvidenceReference) {
  const family =
    reference.sourceType === 'judgment' ? 'judgment' : 'legislation'
  return `${family}:${reference.sourceId}`
}

/**
 * One batched read per source family for a page of findings. A page of 50
 * findings costs at most two queries, not two per finding.
 */
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
      // `source_uri` is the corpus path; the served URL the source is named
      // from is the summary's own `sourceUrl`.
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
