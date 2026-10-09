import { parseDocx } from '@obiter/ooxml'
import { describe, expect, it } from 'bun:test'
import type { AuthzUser } from '../authz'
import { createDocumentMarkingsRoutes } from './document-markings'
import {
  EditDatabase,
  EditStorage,
  expectDocument404,
  sourceKey,
} from './document-edit.test-support'
import { createRouteApp } from './document-route.test-support'

/**
 * Markings are an immutable-version mutation: every change commits a new
 * version of the OOXML package (custom.xml carries the values), gated like
 * an edit — matter edit access, named base version, stale-base conflict,
 * audit. These tests run the real route against the shared edit harness.
 */
function routeApp(
  database: EditDatabase,
  storage = new EditStorage(),
  user: AuthzUser | null = {
    id: 'usr_editor',
    organisationId: 'org_1',
    role: 'member',
  },
) {
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_markings',
      createRoutes: createDocumentMarkingsRoutes,
    }),
    storage,
  }
}

const MARKINGS = {
  documentKind: 'particulars',
  draft: true,
  privileged: true,
  withoutPrejudice: false,
}

function markingsRequest(
  baseVersionId: string | null = 'ver_1',
  markings: unknown = MARKINGS,
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersionId, markings }),
  }
}

describe('POST /api/documents/:id/markings', () => {
  it('commits a new version whose package carries the markings', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/markings',
      markingsRequest(),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      documentId: string
      versionId: string
      versionNumber: number
      markings: unknown
    }
    expect(body).toMatchObject({
      documentId: 'doc_1',
      versionNumber: 2,
      markings: MARKINGS,
    })
    expect(database.transactionCommands).toEqual(['begin', 'commit'])

    // The committed object is a real package: re-parse the stored bytes and
    // read the markings back out of docProps/custom.xml.
    const version = database.versions.get(body.versionId)
    expect(version).toBeDefined()
    const written = storage.binary.get(version!.object_key)
    expect(written).toBeDefined()
    const reparsed = await parseDocx(written!)
    expect(reparsed.model.markings).toEqual(MARKINGS)
    // Content is untouched — the mutation only writes custom properties.
    // Re-serialising canonicalises generated paragraph ids, so compare the
    // paragraph text, not idents or byte offsets.
    const storyText = (model: {
      stories: { paragraphs: { runs: { text: string }[] }[] }[]
    }) =>
      model.stories.map((story) =>
        story.paragraphs.map((paragraph) =>
          paragraph.runs.map((run) => run.text).join(''),
        ),
      )
    const source = await parseDocx(storage.binary.get(sourceKey)!)
    expect(storyText(reparsed.model)).toEqual(storyText(source.model))

    expect(database.audits).toContainEqual(
      expect.objectContaining({
        action: 'document.markings',
        metadata: expect.objectContaining({
          baseVersionId: 'ver_1',
          documentKind: 'particulars',
          draft: true,
          privileged: true,
          withoutPrejudice: false,
        }),
      }),
    )
  })

  it('answers stale when the named base is not the current head', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/markings',
      markingsRequest('ver_stale'),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'conflict_detected' },
    })
    expect(database.transactionCommands).not.toContain('commit')
    expect(database.audits).toEqual([])
    expect(storage.reads).toEqual([])
    expect(storage.writes).toEqual([])
  })

  it('returns the uniform 404 for a view-only grantee without storage access', async () => {
    const database = new EditDatabase({ access: 'view' })
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/markings',
      markingsRequest(),
    )

    await expectDocument404(response)
    expect(storage.reads).toEqual([])
    expect(database.transactionCommands).not.toContain('commit')
  })

  it('returns the uniform 404 for a cross-organisation document', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_cross/markings',
      markingsRequest(),
    )

    await expectDocument404(response)
    expect(storage.reads).toEqual([])
  })

  it('rejects a malformed request before touching storage', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)
    const response = await app.request('/api/documents/doc_1/markings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseVersionId: 'ver_1', markings: {} }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(storage.reads).toEqual([])
    expect(database.transactionCommands).not.toContain('commit')
  })

  it('preserves an unknown stored document kind through a flag toggle', async () => {
    // A kind written by a newer deployment is not in this build's list; the
    // wire schema accepts any stored string so a Draft toggle does not erase
    // it. The audit metadata keeps the opaque string.
    const database = new EditDatabase()
    const { app } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/markings',
      markingsRequest('ver_1', {
        documentKind: 'future-kind-from-newer-build',
        draft: true,
        privileged: false,
        withoutPrejudice: false,
      }),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      markings: { documentKind: string | null }
    }
    expect(body.markings.documentKind).toBe('future-kind-from-newer-build')
  })

  it('rolls the version back when the audit write fails', async () => {
    const database = new EditDatabase({ auditFailure: true })
    const { app } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/markings',
      markingsRequest(),
    )

    expect(response.status).toBe(500)
    expect(database.transactionCommands).toContain('rollback')
    expect(database.transactionCommands).not.toContain('commit')
    expect(database.versions.size).toBe(1)
    expect(database.currentVersionId).toBe('ver_1')
    // The committed bytes were staged in storage but the head never moved
    // and no version row exists — an orphan object is inert.
    expect(database.audits).toEqual([])
  })
})
