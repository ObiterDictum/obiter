import type { Pool } from 'pg'
import type { DocumentCursor, DocumentPresence } from '@obiter/contracts'
import { DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT } from '@obiter/contracts'
import {
  PRESENCE_EXPIRY_MS,
  type DocumentPresenceBackend,
  type DocumentPresenceScope,
} from './document-presence'

/**
 * Heartbeats live longer than one write: the sweep budget bounds how many
 * expired rows a single update may reclaim, so cleanup can never turn a
 * heartbeat into an unbounded delete.
 */
const SWEEP_EXPIRED_LIMIT = 200
/** Rows this far past expiry are dead weight — reclaimable, never readable. */
const SWEEP_GRACE = "interval '1 minute'"

interface PresenceRow {
  user_id: string
  client_id: string
  paragraph_id: string
  run_id: string
  cursor_offset: number
}

/**
 * The production presence backend. All state lives in `document_presence`,
 * keyed by (organisation, document, user, client), so cursors written through
 * one API instance are visible to every other instance sharing the database.
 * Expiry is the database clock (`now()`), never the process clock: a stopped
 * tab's row stops matching reads after the TTL without a delete.
 *
 * Every write is a single statement — upsert, expiry sweep and participant
 * cap run as data-modifying CTEs, so a failed write leaves no partial row set
 * behind.
 */
export class PostgresDocumentPresence implements DocumentPresenceBackend {
  constructor(private readonly pool: Pool) {}

  async update(scope: DocumentPresenceScope, cursor: DocumentCursor | null) {
    if (cursor === null) {
      await this.pool.query(
        `delete from document_presence
         where organisation_id = $1 and document_id = $2
           and user_id = $3 and client_id = $4`,
        [scope.organisationId, scope.documentId, scope.userId, scope.clientId],
      )
      return
    }

    await this.pool.query(
      `with upserted as (
         insert into document_presence (
           organisation_id, matter_id, document_id, version_id,
           user_id, client_id, paragraph_id, run_id, cursor_offset,
           expires_at, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 now() + interval '${PRESENCE_EXPIRY_MS / 1000} seconds',
                 now())
         on conflict (organisation_id, document_id, user_id, client_id)
         do update set
           version_id = excluded.version_id,
           paragraph_id = excluded.paragraph_id,
           run_id = excluded.run_id,
           cursor_offset = excluded.cursor_offset,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
       ), expired as (
         delete from document_presence
         where ctid in (
           select ctid from document_presence
           where expires_at <= now() - ${SWEEP_GRACE}
           limit ${SWEEP_EXPIRED_LIMIT}
         )
       ), over_cap as (
         -- Data-modifying CTEs share the pre-statement snapshot, so the
         -- upsert's own row is invisible here. Excluding its key keeps the
         -- delete from ever colliding with the insert on the same row, and
         -- offsetting at cap-1 leaves the bucket at exactly the cap once the
         -- new row lands.
         delete from document_presence
         where (organisation_id, document_id, user_id, client_id) in (
           select organisation_id, document_id, user_id, client_id
           from document_presence
           where organisation_id = $1 and document_id = $3
             and not (user_id = $5 and client_id = $6)
           order by expires_at desc, user_id, client_id
           offset ${DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT - 1}
         )
       )
       select 1`,
      [
        scope.organisationId,
        scope.matterId,
        scope.documentId,
        scope.versionId,
        scope.userId,
        scope.clientId,
        cursor.paragraphId,
        cursor.runId,
        cursor.offset,
      ],
    )
  }

  async read(scope: {
    organisationId: string
    documentId: string
    versionId: string
  }): Promise<DocumentPresence[]> {
    const result = await this.pool.query<PresenceRow>(
      `select user_id, client_id, paragraph_id, run_id, cursor_offset
       from document_presence
       where organisation_id = $1 and document_id = $2 and version_id = $3
         and expires_at > now()
       order by user_id, client_id
       limit ${DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT}`,
      [scope.organisationId, scope.documentId, scope.versionId],
    )
    return result.rows.map((row) => ({
      userId: row.user_id,
      ...(row.client_id === '' ? {} : { clientId: row.client_id }),
      cursor: {
        paragraphId: row.paragraph_id,
        runId: row.run_id,
        offset: row.cursor_offset,
      },
    }))
  }
}
