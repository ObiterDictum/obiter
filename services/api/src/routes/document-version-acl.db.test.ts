import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { createTestPool } from '../test-database.test-support'
import { createDocumentCompareRoutes } from './document-compare'
import { createDocumentContentRoutes } from './document-content'
import { createDocumentExportRoutes } from './document-export'
import { createDocumentMediaRoutes } from './document-media'
import { createDocumentModelRoutes } from './document-model'
import { createDocumentPdfViewRoutes } from './document-pdf-view'
import { createDocumentsRoutes } from './documents'
import { createTrackedChangeRoutes } from './tracked-changes'
import {
  cleanupMatter,
  editorUser,
  expectConcealed,
  ownerUser,
  seedMatter,
  storageFor,
} from './document-write-share-revocation.test-support'

/**
 * P2-9: version-level ACL. A matter-level 'view' share reads the document as
 * it stands — the current version only. Naming a non-current version on any
 * read path requires 'edit', and the denial is the same concealed 404 a
 * nonexistent version gets. Every test below runs the real routes against a
 * real database: the fixture is a two-version document whose seeded v1
 * (tracked-change source bytes) becomes historical once v2 (plain source
 * bytes) takes over as current.
 */

const plainSourceBytes = await readFile(
  '../../data/evals/redact/demo-fixture.docx',
)
const plainBytesSha256 = createHash('sha256')
  .update(plainSourceBytes)
  .digest('hex')

const pool = createTestPool()

type Seed = Awaited<ReturnType<typeof seedMatter>>

interface TwoVersionSeed extends Seed {
  currentVersionId: string
  currentSourceKey: string
}

/** Promote a fresh v2 to current so the seeded v1 becomes historical. */
async function seedTwoVersions(
  access: 'edit' | 'view' | null,
): Promise<TwoVersionSeed> {
  const seed = await seedMatter(pool, access)
  const currentVersionId = `${seed.versionId}_v2`
  const currentSourceKey = createDocumentObjectKey({
    organisationId: seed.orgId,
    matterId: seed.matterId,
    documentId: seed.documentId,
    versionId: currentVersionId,
  })
  await pool.query(
    `insert into document_versions (
       id, organisation_id, matter_id, matter_document_id, filename,
       file_type, size_bytes, object_key, text_object_key, document_status,
       failure_reason, version_number, content_sha256, sync_state, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, 'synthetic.docx', 'docx', $5, $6, null,
       'ready', null, 2, $7, 'synced', $8, now(), now())`,
    [
      currentVersionId,
      seed.orgId,
      seed.matterId,
      seed.documentId,
      plainSourceBytes.byteLength,
      currentSourceKey,
      plainBytesSha256,
      seed.ownerId,
    ],
  )
  await pool.query(
    `update matter_documents set current_version_id = $1 where id = $2`,
    [currentVersionId, seed.documentId],
  )
  return { ...seed, currentVersionId, currentSourceKey }
}

function storageForTwoVersions(seed: TwoVersionSeed) {
  const storage = storageFor(seed)
  storage.binary.set(seed.currentSourceKey, Buffer.from(plainSourceBytes))
  return storage
}

function readApp(pool: Pool, storage: unknown, user: AuthzUser) {
  const routes = new Hono<{ Variables: AuthzVariables }>()
  routes.use('*', async (c, next) => {
    c.set('requestId', 'req_acl')
    c.set('user', user)
    await next()
  })
  const store = storage as Parameters<typeof createDocumentModelRoutes>[1]
  routes.route('/', createDocumentsRoutes(pool, store))
  routes.route('/', createDocumentModelRoutes(pool, store))
  routes.route('/', createDocumentContentRoutes(pool, store))
  routes.route('/', createDocumentMediaRoutes(pool, store))
  routes.route('/', createDocumentPdfViewRoutes(pool, store))
  routes.route('/', createDocumentExportRoutes(pool, store))
  routes.route('/', createTrackedChangeRoutes(pool, store))
  routes.route('/', createDocumentCompareRoutes(pool, store))
  return routes
}

/** Every read path that accepts `?versionId=` and serves a ready docx. */
function versionedReadPaths(seed: TwoVersionSeed) {
  return [
    `/api/documents/${seed.documentId}/model?versionId=${seed.versionId}`,
    `/api/documents/${seed.documentId}/download?versionId=${seed.versionId}`,
    `/api/documents/${seed.documentId}/text?versionId=${seed.versionId}`,
    `/api/documents/${seed.documentId}/media?versionId=${seed.versionId}&part=word%2Fmedia%2Fmissing.png`,
    `/api/documents/${seed.documentId}/export?versionId=${seed.versionId}`,
    `/api/documents/${seed.documentId}/tracked-changes?versionId=${seed.versionId}`,
    `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.versionId}&targetVersionId=${seed.currentVersionId}`,
  ]
}

describe('historical version concealment', () => {
  it('shows a view grantee only the current version in document metadata', async () => {
    const seed = await seedTwoVersions('view')
    try {
      const storage = storageForTwoVersions(seed)
      const viewer = readApp(pool, storage, editorUser(seed))
      const response = await viewer.request(`/api/documents/${seed.documentId}`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        versions: Array<{ id: string }>
      }
      expect(body.versions.map((v) => v.id)).toEqual([seed.currentVersionId])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('shows an edit grantee the full version list', async () => {
    const seed = await seedTwoVersions('edit')
    try {
      const storage = storageForTwoVersions(seed)
      const editor = readApp(pool, storage, editorUser(seed))
      const response = await editor.request(`/api/documents/${seed.documentId}`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        versions: Array<{ id: string }>
      }
      expect(body.versions.map((v) => v.id)).toEqual([
        seed.currentVersionId,
        seed.versionId,
      ])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

describe('historical version read gate', () => {
  it('denies a view grantee on every version-aware read route', async () => {
    const seed = await seedTwoVersions('view')
    try {
      const storage = storageForTwoVersions(seed)
      const viewer = readApp(pool, storage, editorUser(seed))
      for (const path of versionedReadPaths(seed)) {
        const response = await viewer.request(path)
        expect(path).toBeTruthy()
        await expectConcealed(response)
      }
      // The gate fires before any artifact read: a denied request never
      // touches stored bytes for the historical version.
      expect(storage.binaryReads).toEqual([])
      expect(storage.textReads).toEqual([])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('gives a view grantee the identical 404 for a version that does not exist', async () => {
    const seed = await seedTwoVersions('view')
    try {
      const storage = storageForTwoVersions(seed)
      const viewer = readApp(pool, storage, editorUser(seed))
      const denied = await viewer.request(
        `/api/documents/${seed.documentId}/model?versionId=${seed.versionId}`,
      )
      const missing = await viewer.request(
        `/api/documents/${seed.documentId}/model?versionId=ver_does_not_exist`,
      )
      expect(denied.status).toBe(404)
      expect(missing.status).toBe(404)
      await expect(denied.json()).resolves.toEqual(await missing.json())
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('still serves a view grantee the current version', async () => {
    const seed = await seedTwoVersions('view')
    try {
      const storage = storageForTwoVersions(seed)
      const viewer = readApp(pool, storage, editorUser(seed))
      const response = await viewer.request(
        `/api/documents/${seed.documentId}/model`,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { versionId: string }
      expect(body.versionId).toBe(seed.currentVersionId)
      // The same-versionId current read is also allowed — the gate only
      // fires on non-current versions.
      const named = await viewer.request(
        `/api/documents/${seed.documentId}/model?versionId=${seed.currentVersionId}`,
      )
      expect(named.status).toBe(200)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('serves an edit grantee the historical version on each read route', async () => {
    const seed = await seedTwoVersions('edit')
    try {
      const storage = storageForTwoVersions(seed)
      const editor = readApp(pool, storage, editorUser(seed))

      const model = await editor.request(
        `/api/documents/${seed.documentId}/model?versionId=${seed.versionId}`,
      )
      expect(model.status).toBe(200)
      await expect(model.json()).resolves.toMatchObject({
        versionId: seed.versionId,
        versionNumber: 1,
      })

      const download = await editor.request(
        `/api/documents/${seed.documentId}/download?versionId=${seed.versionId}`,
      )
      expect(download.status).toBe(200)

      const changes = await editor.request(
        `/api/documents/${seed.documentId}/tracked-changes?versionId=${seed.versionId}`,
      )
      expect(changes.status).toBe(200)
      const changesBody = (await changes.json()) as { changes: unknown[] }
      expect(changesBody.changes.length).toBeGreaterThan(0)

      // A denied-looking media 404 reaches storage for an editor (the part is
      // missing), while a denied viewer never got that far — the two 404s sit
      // on different sides of the gate.
      storage.binaryReads.length = 0
      const media = await editor.request(
        `/api/documents/${seed.documentId}/media?versionId=${seed.versionId}&part=word%2Fmedia%2Fmissing.png`,
      )
      expect(media.status).toBe(404)
      expect(storage.binaryReads).toContain(seed.sourceKey)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('lets the matter owner read history without a share', async () => {
    const seed = await seedTwoVersions(null)
    try {
      const storage = storageForTwoVersions(seed)
      const owner = readApp(pool, storage, ownerUser(seed))
      const response = await owner.request(
        `/api/documents/${seed.documentId}/model?versionId=${seed.versionId}`,
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        versionId: seed.versionId,
      })
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('denies a stranger and a version id belonging to another document', async () => {
    const seed = await seedTwoVersions('edit')
    const other = await seedTwoVersions(null)
    try {
      const storage = storageForTwoVersions(seed)
      const stranger = readApp(pool, storage, {
        id: seed.strangerId,
        organisationId: seed.otherOrgId,
        role: 'member',
      })
      await expectConcealed(
        await stranger.request(
          `/api/documents/${seed.documentId}/model?versionId=${seed.versionId}`,
        ),
      )

      // Same-org editor naming a different document's version: the version
      // never appears in this document's version list, so the request is a
      // plain concealed 404 — not a cross-document read.
      const editor = readApp(pool, storage, editorUser(seed))
      await expectConcealed(
        await editor.request(
          `/api/documents/${seed.documentId}/model?versionId=${other.versionId}`,
        ),
      )
    } finally {
      await cleanupMatter(pool, seed)
      await cleanupMatter(pool, other)
    }
  })
})

describe('version comparison', () => {
  it('compares two versions for an edit grantee and reports real entries', async () => {
    const seed = await seedTwoVersions('edit')
    try {
      const storage = storageForTwoVersions(seed)
      const editor = readApp(pool, storage, editorUser(seed))
      const response = await editor.request(
        `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.currentVersionId}&targetVersionId=${seed.versionId}`,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        base: { versionId: string }
        target: { versionId: string }
        entries: unknown[]
        identical: boolean
      }
      expect(body.base.versionId).toBe(seed.currentVersionId)
      expect(body.target.versionId).toBe(seed.versionId)
      // The historical fixture carries tracked changes the plain source
      // lacks: the difference is real, not a metadata echo.
      expect(body.entries.length).toBeGreaterThan(0)
      expect(body.identical).toBe(false)
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('lets a view grantee compare the current version to itself only', async () => {
    const seed = await seedTwoVersions('view')
    try {
      const storage = storageForTwoVersions(seed)
      const viewer = readApp(pool, storage, editorUser(seed))

      // One historical input is enough to deny the whole comparison. The
      // denied requests precede the allowed one so the storage assertion
      // proves the gate fired before any artifact read.
      await expectConcealed(
        await viewer.request(
          `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.versionId}&targetVersionId=${seed.currentVersionId}`,
        ),
      )
      await expectConcealed(
        await viewer.request(
          `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.currentVersionId}&targetVersionId=${seed.versionId}`,
        ),
      )
      expect(storage.binaryReads).toEqual([])
      expect(storage.textReads).toEqual([])

      const same = await viewer.request(
        `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.currentVersionId}&targetVersionId=${seed.currentVersionId}`,
      )
      expect(same.status).toBe(200)
      await expect(same.json()).resolves.toMatchObject({ identical: true })
    } finally {
      await cleanupMatter(pool, seed)
    }
  })

  it('rejects a comparison that names a version of another document', async () => {
    const seed = await seedTwoVersions('edit')
    const other = await seedTwoVersions(null)
    try {
      const storage = storageForTwoVersions(seed)
      const editor = readApp(pool, storage, editorUser(seed))
      await expectConcealed(
        await editor.request(
          `/api/documents/${seed.documentId}/compare?baseVersionId=${other.currentVersionId}&targetVersionId=${seed.currentVersionId}`,
        ),
      )
    } finally {
      await cleanupMatter(pool, seed)
      await cleanupMatter(pool, other)
    }
  })

  it('rejects a comparison missing a version id before touching access', async () => {
    const seed = await seedTwoVersions('edit')
    try {
      const storage = storageForTwoVersions(seed)
      const editor = readApp(pool, storage, editorUser(seed))
      const response = await editor.request(
        `/api/documents/${seed.documentId}/compare?baseVersionId=${seed.currentVersionId}`,
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'validation_failed' },
      })
      expect(storage.binaryReads).toEqual([])
    } finally {
      await cleanupMatter(pool, seed)
    }
  })
})

afterAll(async () => {
  await pool.end()
})
