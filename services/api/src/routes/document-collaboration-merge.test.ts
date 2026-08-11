import { describe, expect, it } from 'vitest'
import { documentCollaborationMergeResponseSchema } from '@obiter/contracts'
import { parseDocx } from '@obiter/ooxml'
import { DocumentPresenceRegistry } from '../document-presence'
import {
  EditDatabase,
  EditStorage,
  sourceBytes,
  sourceKey,
} from './document-edit.test-support'
import {
  collaborationApp,
  firstRun,
  mergeRequest,
  secondRun,
} from './document-collaboration.test-support'

describe('collaboration merges', () => {
  it('creates immutable N+1 with two same-transaction audits and durable idempotency', async () => {
    const database = new EditDatabase()
    const route = collaborationApp(database)
    const original = Buffer.from(sourceBytes)
    const request = mergeRequest(
      'ver_1',
      'sync_once',
      firstRun.id,
      'Merged synthetic revision',
    )

    const created = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      request,
    )
    const createdBody = documentCollaborationMergeResponseSchema.parse(
      await created.json(),
    )
    const readsAfterCreate = route.storage.binaryReads.length
    const restarted = collaborationApp(
      database,
      new DocumentPresenceRegistry(),
      undefined,
      route.storage,
    )
    const replay = await restarted.app.request(
      '/api/documents/doc_1/collaboration/merge',
      request,
    )
    const replayBody = documentCollaborationMergeResponseSchema.parse(
      await replay.json(),
    )

    expect(created.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(created.headers.get('cache-control')).toBe('no-store')
    expect(createdBody).toMatchObject({
      documentId: 'doc_1',
      syncId: 'sync_once',
      baseVersionId: 'ver_1',
      versionNumber: 2,
      outcome: 'merged',
    })
    expect(replayBody).toEqual({
      ...createdBody,
      outcome: 'already_applied',
    })
    expect(database.versions.size).toBe(2)
    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.version_create',
      'document.collaboration_merge',
    ])
    expect(database.audits[1]?.metadata).toEqual({
      syncId: 'sync_once',
      baseVersionId: 'ver_1',
      newVersionId: createdBody.versionId,
      operationCount: 1,
      outcome: 'merged',
    })
    expect(database.transactionCommands).toEqual([
      'begin',
      'commit',
      'begin',
      'rollback',
    ])
    expect(route.storage.binaryReads).toHaveLength(readsAfterCreate)
    expect(route.storage.writes).toHaveLength(1)
    expect(route.storage.binary.get(sourceKey)).toEqual(original)
    expect(JSON.stringify(database.audits)).not.toContain(
      'Merged synthetic revision',
    )
    expect(JSON.stringify(database.audits)).not.toContain('<w:')
    expect(
      database.queries.some((sql) => sql.includes('for update of document')),
    ).toBe(true)
  })

  it('scopes a sync id to the authenticated user', async () => {
    const database = new EditDatabase()
    const route = collaborationApp(database)
    const first = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_shared', firstRun.id, 'First revision'),
    )
    const otherUser = collaborationApp(
      database,
      new DocumentPresenceRegistry(),
      {
        id: 'usr_other',
        name: 'Other Editor',
        organisationId: 'org_1',
        role: 'member',
      },
      route.storage,
    )
    const second = await otherUser.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_shared', secondRun.id, 'Second revision'),
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(database.versions.size).toBe(3)
    expect(database.audits).toHaveLength(4)
  })

  it('merges disjoint stale edits into the next version while retaining both changes', async () => {
    const database = new EditDatabase()
    const route = collaborationApp(database)
    const first = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_first', firstRun.id, 'First revision'),
    )
    const second = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_second', secondRun.id, 'Second revision'),
    )
    const body = documentCollaborationMergeResponseSchema.parse(
      await second.json(),
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(body).toMatchObject({ versionNumber: 3, outcome: 'merged' })
    expect(database.versions.size).toBe(3)
    const version = database.versions.get(body.versionId)
    const bytes = route.storage.binary.get(version?.object_key ?? '')
    if (!bytes) throw new Error('Merged source is missing.')
    const merged = await parseDocx(bytes)
    const runs = merged.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.flatMap(({ runs: paragraphRuns }) => paragraphRuns)
    expect(runs?.find(({ id }) => id === firstRun.id)?.text).toBe(
      'First revision',
    )
    expect(runs?.find(({ id }) => id === secondRun.id)?.text).toBe(
      'Second revision',
    )
    expect(route.storage.binary.get(sourceKey)).toEqual(sourceBytes)
  })

  it('returns 409 for an overlapping stale edit without another version or audit', async () => {
    const database = new EditDatabase()
    const route = collaborationApp(database)
    await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_winner', firstRun.id, 'Winner'),
    )
    const writes = route.storage.writes.length
    const conflict = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_loser', firstRun.id, 'Loser'),
    )
    const body = await conflict.json()

    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      error: { code: 'conflict_detected' },
      conflict: {
        documentId: 'doc_1',
        syncId: 'sync_loser',
        baseVersionId: 'ver_1',
        currentVersionNumber: 2,
        operationIndexes: [0],
      },
    })
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(route.storage.writes).toHaveLength(writes)
    expect(JSON.stringify(body)).not.toContain('Loser')
  })

  it('serialises concurrent overlapping merges so only one creates N+1', async () => {
    const database = new EditDatabase()
    const storage = new EditStorage()
    let releaseRead: () => void = () => undefined
    storage.readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const route = collaborationApp(database, undefined, undefined, storage)

    const first = route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_concurrent_1', firstRun.id, 'First'),
    )
    const second = route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_concurrent_2', firstRun.id, 'Second'),
    )
    await waitFor(() => storage.binaryReads.length === 1)
    releaseRead()
    const responses = await Promise.all([first, second])

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(route.storage.writes).toHaveLength(1)
  })

  it('keeps the candidate when the commit response is uncertain', async () => {
    const database = new EditDatabase({ commitResponseFailure: true })
    const route = collaborationApp(database)
    const response = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_uncertain', firstRun.id, 'Revision'),
    )

    expect(response.status).toBe(500)
    expect(database.currentVersionId).not.toBe('ver_1')
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(route.storage.writes).toHaveLength(1)
    expect(route.storage.deletes).toEqual([])
    expect(route.storage.binary.has(route.storage.writes[0] ?? '')).toBe(true)
  })

  it('rolls back both audits and removes the candidate object on failure', async () => {
    const database = new EditDatabase({ auditFailure: true })
    const route = collaborationApp(database)
    const response = await route.app.request(
      '/api/documents/doc_1/collaboration/merge',
      mergeRequest('ver_1', 'sync_rollback', firstRun.id, 'Revision'),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(route.storage.deletes).toEqual(route.storage.writes)
    expect(route.storage.binary.size).toBe(1)
    expect(route.errors).toEqual(['The edited document could not be stored.'])
  })
})

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for collaboration merge preparation.')
}
