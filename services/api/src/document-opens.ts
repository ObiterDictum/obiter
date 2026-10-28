import type { Pool } from 'pg'
import type { RecentlyOpenedDocument } from '@obiter/contracts'
import { matterAccessPredicate } from './matter-access-boundary'

/**
 * "Where you left off", stored per person rather than per document: it is a
 * fact about a reader, not about the file. Access is not implied by a row —
 * both the write and the read are gated by the matter boundary, so a row that
 * outlives a revoked share cannot surface the document.
 */

/** Record that this person opened the document now. Returns the stored time. */
export async function recordDocumentOpen(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    documentId: string
    matterId: string
  },
): Promise<string> {
  const result = await pool.query<{ opened_at: Date | string }>(
    `insert into document_opens (
       organisation_id, matter_id, document_id, user_id, opened_at
     )
     values ($1, $2, $3, $4, now())
     on conflict (document_id, user_id) do update set opened_at = now()
     returning opened_at`,
    [input.organisationId, input.matterId, input.documentId, input.userId],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Document open upsert returned no row.')
  return row.opened_at instanceof Date
    ? row.opened_at.toISOString()
    : row.opened_at
}

interface RecentlyOpenedRow {
  document_id: string
  matter_id: string
  matter_name: string
  filename: string
  opened_at: Date | string
}

/**
 * The newest document this person may still read. A document deleted since, or
 * a matter they no longer reach, is skipped rather than shown and then refused:
 * the answer is the last place they can actually continue from.
 */
export async function getRecentlyOpenedDocument(
  pool: Pool,
  user: { id: string; organisationId: string },
): Promise<RecentlyOpenedDocument | null> {
  const result = await pool.query<RecentlyOpenedRow>(
    `select open.document_id, open.matter_id, matter.name as matter_name,
            version.filename, open.opened_at
     from document_opens open
     join matter_documents document
       on document.id = open.document_id
      and document.organisation_id = open.organisation_id
     join matters matter
       on matter.id = document.matter_id
      and matter.organisation_id = document.organisation_id
     join document_versions version on version.id = document.current_version_id
     where open.user_id = $1
       and open.organisation_id = $2
       and document.deleted_at is null
       and matter.deleted_at is null
       and ${matterAccessPredicate('$1', "'view'")}
     order by open.opened_at desc, open.document_id
     limit 1`,
    [user.id, user.organisationId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    documentId: row.document_id,
    matterId: row.matter_id,
    matterName: row.matter_name,
    filename: row.filename,
    openedAt:
      row.opened_at instanceof Date
        ? row.opened_at.toISOString()
        : row.opened_at,
  }
}
