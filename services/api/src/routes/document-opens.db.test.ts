import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createTestPool } from '../test-database.test-support'
import { createDocumentsRoutes } from './documents'
import {
  cleanupMatter,
  editorUser,
  seedMatter,
} from './document-write-share-revocation.test-support'

/**
 * "Continue where you left off" is one row per (document, person) and it is not
 * an access grant: recording an open needs the document read permission, and the
 * read skips a document the person can no longer reach. Both halves run the real
 * routes against a real database.
 */

const pool: Pool = createTestPool()

function documentsApp(user: AuthzUser, requestId = 'req_opens') {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', requestId)
    c.set('user', user)
    await next()
  })
  routes.route('/', createDocumentsRoutes(pool))
  return routes
}

afterAll(async () => {
  await pool.end()
})

describe('document opens', () => {
  it('records the open and answers with the document this person last read', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const app = documentsApp(editorUser(seed))

      const recorded = await app.request(
        `/api/documents/${seed.documentId}/opened`,
        { method: 'POST' },
      )
      expect(recorded.status).toBe(200)
      expect(await recorded.json()).toMatchObject({
        documentId: seed.documentId,
      })

      const recent = await app.request('/api/documents/recently-opened')
      expect(recent.status).toBe(200)
      const body = (await recent.json()) as {
        document: Record<string, unknown> | null
      }
      expect(body.document).toMatchObject({
        documentId: seed.documentId,
        matterId: seed.matterId,
        matterName: `Race matter ${seed.matterId.slice('mtr_race_'.length)}`,
        filename: 'synthetic.docx',
      })
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('moves the timestamp instead of listing the same document twice', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const app = documentsApp(editorUser(seed))
      await app.request(`/api/documents/${seed.documentId}/opened`, {
        method: 'POST',
      })
      await pool.query(
        `update document_opens set opened_at = now() - interval '2 hours'
         where document_id = $1`,
        [seed.documentId],
      )
      await app.request(`/api/documents/${seed.documentId}/opened`, {
        method: 'POST',
      })

      const rows = await pool.query<{ count: string; opened_at: Date }>(
        `select count(*)::text as count, max(opened_at) as opened_at
         from document_opens where document_id = $1`,
        [seed.documentId],
      )
      expect(rows.rows[0]?.count).toBe('1')
      const age = Date.now() - (rows.rows[0]?.opened_at.getTime() ?? 0)
      expect(age).toBeLessThan(60_000)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('refuses to record an open for a document the caller cannot read', async () => {
    const seed = await seedMatter(pool, null)
    try {
      const response = await documentsApp(editorUser(seed)).request(
        `/api/documents/${seed.documentId}/opened`,
        { method: 'POST' },
      )
      expect(response.status).toBe(404)
      const stored = await pool.query(
        `select 1 from document_opens where document_id = $1`,
        [seed.documentId],
      )
      expect(stored.rowCount).toBe(0)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('stops naming a document once the person loses access to it', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      await documentsApp(editorUser(seed)).request(
        `/api/documents/${seed.documentId}/opened`,
        { method: 'POST' },
      )
      await pool.query(`delete from matter_shares where id = $1`, [
        seed.shareId,
      ])

      const recent = await documentsApp(editorUser(seed)).request(
        '/api/documents/recently-opened',
      )
      expect(await recent.json()).toEqual({ document: null })
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})
