import { afterAll, describe, expect, it } from 'bun:test'
import { DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT } from '@obiter/contracts'
import type { DocumentCursor } from '@obiter/contracts'
import { PostgresDocumentPresence } from './document-presence-store'
import type { DocumentPresenceScope } from './document-presence'
import { createTestPool } from './test-database.test-support'
import {
  app as routeApp,
  cleanupMatter,
  editorUser,
  jsonRequest,
  ownerUser,
  seedMatter,
  storageFor,
} from './routes/document-write-share-revocation.test-support'

/**
 * P2-8: presence is Postgres-backed, so cursors written through one API
 * instance are visible to another. Two `PostgresDocumentPresence` objects
 * over one pool are two instances; two mounted route apps over the same
 * pool prove the same at the HTTP boundary — no shared registry object.
 */

const pool = createTestPool()

type Seed = Awaited<ReturnType<typeof seedMatter>>

function scopeFor(
  seed: Seed,
  userId: string,
  clientId: string,
): DocumentPresenceScope {
  return {
    organisationId: seed.orgId,
    matterId: seed.matterId,
    documentId: seed.documentId,
    versionId: seed.versionId,
    userId,
    clientId,
  }
}

function cursor(seed: Seed): DocumentCursor {
  return {
    paragraphId: `p_${seed.documentId}`,
    runId: `r_${seed.documentId}`,
    offset: 0,
  }
}

/** Read straight past the backend to assert exactly what was stored. */
async function rawRows(seed: Seed) {
  const result = await pool.query<{
    user_id: string
    client_id: string
    version_id: string
  }>(
    `select user_id, client_id, version_id from document_presence
     where organisation_id = $1 and document_id = $2
     order by user_id, client_id`,
    [seed.orgId, seed.documentId],
  )
  return result.rows
}

describe('PostgresDocumentPresence', () => {
  it('shares a cursor written through one store instance with another', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const instanceA = new PostgresDocumentPresence(pool)
      const instanceB = new PostgresDocumentPresence(pool)
      await instanceA.update(
        scopeFor(seed, seed.editorId, 'tab-1'),
        cursor(seed),
      )
      const participants = await instanceB.read({
        organisationId: seed.orgId,
        documentId: seed.documentId,
        versionId: seed.versionId,
      })
      expect(participants).toEqual([
        {
          userId: seed.editorId,
          clientId: 'tab-1',
          cursor: cursor(seed),
        },
      ])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('scopes reads to the resolved current version', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const store = new PostgresDocumentPresence(pool)
      await store.update(scopeFor(seed, seed.editorId, 'tab-1'), cursor(seed))
      // A heartbeat anchored to a superseded version stops matching the
      // current-version read without needing a delete.
      expect(
        await store.read({
          organisationId: seed.orgId,
          documentId: seed.documentId,
          versionId: 'ver_superseded',
        }),
      ).toEqual([])
      expect(
        await store.read({
          organisationId: seed.orgId,
          documentId: seed.documentId,
          versionId: seed.versionId,
        }),
      ).toHaveLength(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('keeps two tabs of one account distinct and leaves only the closed one', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const store = new PostgresDocumentPresence(pool)
      await store.update(scopeFor(seed, seed.editorId, 'tab-1'), cursor(seed))
      await store.update(scopeFor(seed, seed.editorId, 'tab-2'), cursor(seed))
      await store.update(scopeFor(seed, seed.ownerId, 'tab-9'), cursor(seed))

      // Leaving on one tab removes exactly that row; the other tab and the
      // other user are untouched.
      await store.update(scopeFor(seed, seed.editorId, 'tab-1'), null)

      const participants = await store.read({
        organisationId: seed.orgId,
        documentId: seed.documentId,
        versionId: seed.versionId,
      })
      expect(participants.map((p) => [p.userId, p.clientId])).toEqual([
        [seed.editorId, 'tab-2'],
        [seed.ownerId, 'tab-9'],
      ])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('never returns a row past its expiry, and a later write sweeps it', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const store = new PostgresDocumentPresence(pool)
      await store.update(scopeFor(seed, seed.editorId, 'tab-1'), cursor(seed))
      // Age the row past expiry without a delete, the way a closed tab's
      // heartbeat simply stops.
      await pool.query(
        `update document_presence
         set expires_at = now() - interval '2 minutes'
         where organisation_id = $1 and document_id = $2`,
        [seed.orgId, seed.documentId],
      )
      expect(
        await store.read({
          organisationId: seed.orgId,
          documentId: seed.documentId,
          versionId: seed.versionId,
        }),
      ).toEqual([])

      // The next write's bounded sweep reclaims the dead row.
      await store.update(scopeFor(seed, seed.ownerId, 'tab-9'), cursor(seed))
      expect(await rawRows(seed)).toHaveLength(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('isolates presence by organisation and document', async () => {
    const seed = await seedMatter(pool, 'edit')
    const other = await seedMatter(pool, null)
    try {
      const store = new PostgresDocumentPresence(pool)
      await store.update(scopeFor(seed, seed.editorId, 'tab-1'), cursor(seed))
      await store.update(
        scopeFor(other, other.editorId, 'tab-1'),
        cursor(other),
      )
      // Cross-organisation and cross-document reads see nothing.
      expect(
        await store.read({
          organisationId: seed.otherOrgId,
          documentId: seed.documentId,
          versionId: seed.versionId,
        }),
      ).toEqual([])
      expect(
        await store.read({
          organisationId: seed.orgId,
          documentId: other.documentId,
          versionId: seed.versionId,
        }),
      ).toEqual([])
      expect(
        await store.read({
          organisationId: other.orgId,
          documentId: other.documentId,
          versionId: other.versionId,
        }),
      ).toHaveLength(1)
    } finally {
      await cleanupMatter(pool, seed)
      await cleanupMatter(pool, other)
    }
  })

  it('bounds the participant list at the contract cap', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      // The participant cap counts distinct users/tabs; synthesise members
      // rather than reusing the two seeded users.
      const extras = Array.from(
        { length: DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT + 5 },
        (_, index) => `usr_race_extra_${index}_${seed.matterId.slice(-6)}`,
      )
      await pool.query(
        `insert into users (
           id, name, email, "emailVerified", "organisationId", role,
           "createdAt", "updatedAt"
         )
         select id, 'Extra', id || '@example.com', true, $1, 'member',
                now(), now()
         from unnest($2::text[]) as id`,
        [seed.orgId, extras],
      )
      const store = new PostgresDocumentPresence(pool)
      for (const userId of extras) {
        await store.update(scopeFor(seed, userId, 'tab-1'), cursor(seed))
      }
      const participants = await store.read({
        organisationId: seed.orgId,
        documentId: seed.documentId,
        versionId: seed.versionId,
      })
      expect(participants.length).toBe(
        DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT,
      )
      const stored = await rawRows(seed)
      expect(stored.length).toBe(DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('concurrent heartbeats for one client upsert into a single row', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const store = new PostgresDocumentPresence(pool)
      const scope = scopeFor(seed, seed.editorId, 'tab-1')
      await Promise.all([
        store.update(scope, { ...cursor(seed), offset: 1 }),
        store.update(scope, { ...cursor(seed), offset: 2 }),
        store.update(scope, { ...cursor(seed), offset: 3 }),
      ])
      expect(await rawRows(seed)).toHaveLength(1)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('refuses a heartbeat row naming a version that does not exist', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      const store = new PostgresDocumentPresence(pool)
      await expect(
        store.update(
          { ...scopeFor(seed, seed.editorId, 'tab-1'), versionId: 'ver_fake' },
          cursor(seed),
        ),
      ).rejects.toThrow()
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

describe('presence across independent route instances', () => {
  it('a cursor written through one app is read back through another', async () => {
    const seed = await seedMatter(pool, 'edit')
    try {
      // Two route apps sharing one pool are two API instances: neither
      // holds presence state, so visibility must come from Postgres.
      const instanceA = routeApp(
        pool,
        storageFor(seed),
        editorUser(seed),
        'req_presence_a',
      )
      const instanceB = routeApp(
        pool,
        storageFor(seed),
        ownerUser(seed),
        'req_presence_b',
      )

      const modelJson = storageFor(seed).text.get(seed.modelKey)
      const model = JSON.parse(modelJson ?? '{}')
      const paragraph = model.stories.find(
        (story: { kind: string }) => story.kind === 'document',
      ).paragraphs[0]
      const put = await instanceA.request(
        `/api/documents/${seed.documentId}/collaboration/presence`,
        jsonRequest('PUT', {
          cursor: {
            paragraphId: paragraph.id,
            runId: paragraph.runs[0].id,
            offset: 0,
          },
          clientId: 'tab-1',
        }),
      )
      expect(put.status).toBe(204)

      const sync = await instanceB.request(
        `/api/documents/${seed.documentId}/collaboration/sync`,
      )
      expect(sync.status).toBe(200)
      const body = (await sync.json()) as { participants: unknown[] }
      expect(body.participants).toEqual([
        {
          userId: seed.editorId,
          clientId: 'tab-1',
          cursor: {
            paragraphId: paragraph.id,
            runId: paragraph.runs[0].id,
            offset: 0,
          },
        },
      ])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
