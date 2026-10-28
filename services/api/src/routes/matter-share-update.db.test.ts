import { afterAll, describe, expect, it } from 'bun:test'
import type { Pool } from 'pg'
import { createTestPool } from '../test-database.test-support'
import {
  cleanupMatter,
  editorUser,
  ownerUser,
  seedMatter,
  shareApp,
} from './document-write-share-revocation.test-support'

/**
 * Changing a grant's access in place. The Share dialog lets the owner move
 * somebody between "Can view" and "Can edit" without revoking and re-granting,
 * so the route behind it has to be owner-only, audited, and refuse an unknown
 * share with the same 404 the read routes use.
 */

const pool: Pool = createTestPool()

afterAll(async () => {
  await pool.end()
})

async function accessLevel(shareId: string) {
  const result = await pool.query<{ access_level: string }>(
    `select access_level from matter_shares where id = $1`,
    [shareId],
  )
  return result.rows[0]?.access_level ?? null
}

describe('PATCH matter share', () => {
  it('moves a grant between view and edit and records the change', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const response = await shareApp(
        pool,
        ownerUser(seed),
        'req_update',
      ).request(`/api/matters/${seed.matterId}/shares/${seed.shareId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessLevel: 'edit' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        share: { id: seed.shareId, accessLevel: 'edit' },
      })
      expect(await accessLevel(seed.shareId)).toBe('edit')

      const audit = await pool.query<{ action: string }>(
        `select action from audit_logs
         where organisation_id = $1 and entity_id = $2`,
        [seed.orgId, seed.shareId],
      )
      expect(audit.rows.map((row) => row.action)).toEqual([
        'matter.share_update',
      ])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('refuses a grantee changing their own access, even with edit rights', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const response = await shareApp(
        pool,
        editorUser(seed),
        'req_update_self',
      ).request(`/api/matters/${seed.matterId}/shares/${seed.shareId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessLevel: 'edit' }),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error: { code: 'forbidden' },
      })
      expect(await accessLevel(seed.shareId)).toBe('edit')
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('answers an unknown share with the share 404, not a silent success', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const response = await shareApp(
        pool,
        ownerUser(seed),
        'req_update_404',
      ).request(`/api/matters/${seed.matterId}/shares/shr_missing`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessLevel: 'edit' }),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        error: { code: 'matter_share_not_found' },
      })
      expect(await accessLevel(seed.shareId)).toBe('view')
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('rejects an access level that is not one the product has', async () => {
    const seed = await seedMatter(pool, 'view')
    try {
      const response = await shareApp(
        pool,
        ownerUser(seed),
        'req_update_400',
      ).request(`/api/matters/${seed.matterId}/shares/${seed.shareId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessLevel: 'owner' }),
      })

      expect(response.status).toBe(400)
      expect(await accessLevel(seed.shareId)).toBe('view')
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})
