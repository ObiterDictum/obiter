import { describe, expect, it } from 'vitest'
import { documentCollaborationSyncResponseSchema } from '@obiter/contracts'
import { DocumentPresenceRegistry } from '../document-presence'
import {
  EditDatabase,
  sourceBytes,
  sourceKey,
} from './document-edit.test-support'
import { expectDocument404 } from './document-route.test-support'
import {
  collaborationApp,
  cursor,
  firstRun,
  mergeRequest,
  presenceRequest,
} from './document-collaboration.test-support'

describe('document collaboration route gates', () => {
  const cases = [
    ['sync', '/api/documents/doc_1/collaboration/sync', undefined],
    [
      'presence',
      '/api/documents/doc_1/collaboration/presence',
      presenceRequest(cursor),
    ],
    [
      'merge',
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_gate', firstRun.id, 'Revision'),
    ],
  ] as const

  it.each(cases)(
    '%s rejects unauthenticated access before database or storage',
    async (_label, path, request) => {
      const route = collaborationApp(new EditDatabase(), undefined, null)
      const response = await route.app.request(path, request)

      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(route.database.queries).toEqual([])
      expect(route.storage.binaryReads).toEqual([])
    },
  )

  it.each(cases)(
    '%s returns uniform 404s for unknown, cross-organisation, and deleted documents',
    async (_label, path, request) => {
      for (const documentId of ['doc_unknown', 'doc_cross', 'doc_deleted']) {
        const route = collaborationApp(new EditDatabase())
        const response = await route.app.request(
          path.replace('doc_1', documentId),
          request,
        )
        await expectDocument404(response)
        expect(route.storage.binaryReads).toEqual([])
      }
    },
  )

  it.each(cases)(
    '%s requires edit access through the shared matter gate',
    async (_label, path, request) => {
      const route = collaborationApp(new EditDatabase({ access: 'view' }))
      const response = await route.app.request(path, request)

      await expectDocument404(response)
      expect(route.storage.binaryReads).toEqual([])
      expect(
        route.database.queries.some((sql) => sql.includes('matter_shares')),
      ).toBe(true)
    },
  )

  it.each(cases)(
    '%s hides non-ready and non-DOCX current versions',
    async (_label, path, request) => {
      for (const options of [
        { status: 'processing' as const },
        { fileType: 'pdf' },
        { currentVersionId: null },
      ]) {
        const route = collaborationApp(new EditDatabase(options))
        const response = await route.app.request(path, request)
        await expectDocument404(response)
        expect(route.storage.binaryReads).toEqual([])
      }
    },
  )

  it('runs route validation only after the shared gate', async () => {
    const denied = collaborationApp(new EditDatabase({ access: 'view' }))
    await expectDocument404(
      await denied.app.request(
        '/api/documents/doc_1/collaboration/presence',
        presenceRequest({ ...cursor, paragraphId: '' }),
      ),
    )

    const allowed = collaborationApp(new EditDatabase())
    const invalid = await allowed.app.request(
      '/api/documents/doc_1/collaboration/sync?sinceVersionId=',
    )
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('cache-control')).toBe('no-store')
  })

  it('returns the uniform 404 for invalid base-version states', async () => {
    const route = collaborationApp(new EditDatabase())
    const missing = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_unknown', 'sync_missing', firstRun.id, 'Revision'),
    )
    await expectDocument404(missing)
    expect(route.storage.binaryReads).toEqual([])
    expect(route.database.transactionCommands).toEqual([])

    const created = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_seed', firstRun.id, 'Seed revision'),
    )
    expect(created.status).toBe(201)
    const invalidBaseId = route.database.currentVersionId
    const invalidBase = invalidBaseId
      ? route.database.versions.get(invalidBaseId)
      : undefined
    if (!invalidBase) throw new Error('Seed version is missing.')
    invalidBase.document_status = 'processing'
    route.database.currentVersionId = 'ver_1'

    const nonReady = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest(invalidBase.id, 'sync_non_ready', firstRun.id, 'Revision'),
    )
    await expectDocument404(nonReady)
    expect(route.database.versions.size).toBe(2)
  })
})

describe('collaboration sync and presence', () => {
  it('polls authoritative version metadata and returns only sorted cursor references', async () => {
    const presence = new DocumentPresenceRegistry()
    presence.update('org_1', 'doc_1', 'usr_z', cursor)
    presence.update('org_1', 'doc_1', 'usr_a', {
      ...cursor,
      offset: 1,
    })
    const route = collaborationApp(new EditDatabase(), presence)

    const unchanged = await route.app.request(
      '/api/documents/doc_1/collaboration/sync?sinceVersionId=ver_1',
    )
    const body = documentCollaborationSyncResponseSchema.parse(
      await unchanged.json(),
    )

    expect(unchanged.status).toBe(200)
    expect(unchanged.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      documentId: 'doc_1',
      currentVersionId: 'ver_1',
      currentVersionNumber: 1,
      changed: false,
      participants: [
        { userId: 'usr_a', cursor: { ...cursor, offset: 1 } },
        { userId: 'usr_z', cursor },
      ],
    })
    expect(Object.keys(body)).toEqual([
      'documentId',
      'currentVersionId',
      'currentVersionNumber',
      'changed',
      'participants',
    ])
    expect(
      body.participants.map((participant) =>
        Object.keys(participant.cursor ?? {}),
      ),
    ).toEqual([
      ['paragraphId', 'runId', 'offset'],
      ['paragraphId', 'runId', 'offset'],
    ])
    expect(JSON.stringify(body)).not.toContain('objectKey')
    expect(route.storage.binaryReads).toEqual([])
    expect(route.database.audits).toEqual([])
  })

  it('accepts, clears, and forgets an ephemeral cursor without audit or persistence', async () => {
    const database = new EditDatabase()
    const presence = new DocumentPresenceRegistry()
    const route = collaborationApp(database, presence)
    const original = Buffer.from(sourceBytes)

    const accepted = await route.app.request(
      '/api/documents/doc_1/collaboration/presence',
      presenceRequest(cursor),
    )
    expect(accepted.status).toBe(204)
    expect(accepted.headers.get('cache-control')).toBe('no-store')

    const visible = await route.app.request(
      '/api/documents/doc_1/collaboration/sync',
    )
    await expect(visible.json()).resolves.toMatchObject({
      participants: [{ userId: 'usr_editor', cursor }],
    })

    const restarted = collaborationApp(
      database,
      new DocumentPresenceRegistry(),
      undefined,
      route.storage,
    )
    await expect(
      (
        await restarted.app.request('/api/documents/doc_1/collaboration/sync')
      ).json(),
    ).resolves.toMatchObject({ participants: [] })

    const cleared = await route.app.request(
      '/api/documents/doc_1/collaboration/presence',
      presenceRequest(null),
    )
    expect(cleared.status).toBe(204)
    expect(presence.read('org_1', 'doc_1')).toEqual([])
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual([])
    expect(database.versions.size).toBe(1)
    expect(route.storage.binary.get(sourceKey)).toEqual(original)
    expect(route.storage.textWrites).toEqual([])
  })

  it('rejects content-bearing or unresolved cursor updates', async () => {
    const route = collaborationApp(new EditDatabase())
    const content = await route.app.request(
      '/api/documents/doc_1/collaboration/presence',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cursor, commentText: 'private comment' }),
      },
    )
    const unresolved = await route.app.request(
      '/api/documents/doc_1/collaboration/presence',
      presenceRequest({ ...cursor, runId: 'run_missing' }),
    )

    expect(content.status).toBe(400)
    expect(unresolved.status).toBe(400)
    expect(route.database.audits).toEqual([])
    expect(route.database.transactionCommands).toEqual([])
  })
})
