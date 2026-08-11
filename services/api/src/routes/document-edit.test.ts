import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '@obiter/ooxml'
import {
  EditDatabase,
  EditStorage,
  editRequest,
  expectDocument404,
  routeApp,
  sourceBytes,
  sourceKey,
} from './document-edit.test-support'

describe('POST /api/documents/:id/edit', () => {
  it('rejects unauthenticated access before database or storage access', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database, new EditStorage(), null)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.reads).toEqual([])
  })

  it('provisions an organisation for an org-less editor before saving', async () => {
    const database = new EditDatabase()
    const route = routeApp(database, new EditStorage(), {
      id: 'usr_editor',
      organisationId: null,
      role: null,
    })

    const response = await route.app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(201)
    expect(
      database.transactionCommands.filter(
        (command) => command === 'begin' || command === 'commit',
      ),
    ).toEqual(['begin', 'commit', 'begin', 'commit'])
  })

  it.each(['doc_unknown', 'doc_cross', 'doc_deleted'])(
    'returns the uniform 404 for %s without storage access',
    async (documentId) => {
      const { app, storage } = routeApp(new EditDatabase())
      const response = await app.request(
        `/api/documents/${documentId}/edit`,
        editRequest(),
      )

      await expectDocument404(response)
      expect(storage.reads).toEqual([])
    },
  )

  it('denies a view grantee through the shared document gate', async () => {
    const database = new EditDatabase({ access: 'view' })
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    await expectDocument404(response)
    expect(storage.reads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it.each([
    ['a processing version', { status: 'processing' }],
    ['a PDF version', { fileType: 'pdf' }],
    ['an absent current pointer', { currentVersionId: null }],
  ] as const)('returns the uniform 404 for %s', async (_label, options) => {
    const { app, storage } = routeApp(new EditDatabase(options))
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    await expectDocument404(response)
    expect(storage.reads).toEqual([])
  })

  it('validates the request only after the shared document gate', async () => {
    const denied = routeApp(new EditDatabase({ access: 'view' }))
    const invalidDenied = await denied.app.request(
      '/api/documents/doc_1/edit',
      editRequest(''),
    )
    await expectDocument404(invalidDenied)

    const allowed = routeApp(new EditDatabase())
    const invalidAllowed = await allowed.app.request(
      '/api/documents/doc_1/edit',
      editRequest(''),
    )
    expect(invalidAllowed.status).toBe(400)
    expect(invalidAllowed.headers.get('cache-control')).toBe('no-store')
    await expect(invalidAllowed.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(allowed.storage.reads).toEqual([])
  })

  it('returns 409 for a stale base before reading source storage', async () => {
    const { app, storage } = routeApp(new EditDatabase())
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest('ver_stale'),
    )

    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'conflict_detected' },
    })
    expect(storage.reads).toEqual([])
    expect(storage.writes).toEqual([])
  })

  it.each([
    [
      'uses the trimmed session name',
      '  Session Reviewer  ',
      'Session Reviewer',
    ],
    [
      'falls back to the session user id for an empty name',
      '   ',
      'usr_editor',
    ],
  ])(
    '%s when recording tracked edits',
    async (_label, name, expectedAuthor) => {
      const database = new EditDatabase()
      const { app, storage, errors } = routeApp(database, new EditStorage(), {
        id: 'usr_editor',
        name,
        organisationId: 'org_1',
        role: 'member',
      })
      const response = await app.request(
        '/api/documents/doc_1/edit',
        editRequest('ver_1', 'Tracked synthetic revision', true),
      )

      expect(response.status).toBe(201)
      const body = (await response.json()) as { versionId: string }
      const version = database.versions.get(body.versionId)
      const source = storage.binary.get(version?.object_key ?? '')
      if (!source) throw new Error('Tracked source was not stored.')
      const changes = (await parseDocx(source)).model.changes.filter(
        ({ author }) => author === expectedAuthor,
      )
      expect(changes.map(({ elementName }) => elementName)).toEqual([
        'del',
        'ins',
      ])
      expect(
        changes.every(({ date }) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date ?? ''),
        ),
      ).toBe(true)
      expect(JSON.stringify(body)).not.toContain(expectedAuthor)
      expect(JSON.stringify(database.audits)).not.toContain(expectedAuthor)
      expect(JSON.stringify(errors)).not.toContain(expectedAuthor)
    },
  )

  it('creates immutable version N+1 with a model-ready null text artifact and same-transaction audits', async () => {
    const database = new EditDatabase()
    const original = Buffer.from(sourceBytes)
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest('ver_1', 'Edited synthetic text'),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as {
      documentId: string
      versionId: string
      versionNumber: number
    }
    expect(body).toEqual({
      documentId: 'doc_1',
      versionId: expect.stringMatching(/^ver_/u),
      versionNumber: 2,
    })
    expect(database.currentVersionId).toBe(body.versionId)
    expect(database.versions.size).toBe(2)
    expect(storage.binary.get(sourceKey)).toEqual(original)

    const version = database.versions.get(body.versionId)
    const edited = storage.binary.get(version?.object_key ?? '')
    expect(version).toMatchObject({
      version_number: 2,
      filename: 'synthetic.docx',
      file_type: 'docx',
      document_status: 'ready',
      failure_reason: null,
      sync_state: 'synced',
      text_object_key: null,
      created_by: 'usr_editor',
    })
    expect(version?.object_key).toBe(
      `org/org_1/matters/mtr_1/documents/doc_1/versions/${body.versionId}/source`,
    )
    expect(version?.content_sha256).toBe(
      createHash('sha256')
        .update(edited ?? Buffer.alloc(0))
        .digest('hex'),
    )
    expect(version?.content_sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(version?.size_bytes).toBe(String(edited?.byteLength))
    if (!edited) throw new Error('Edited source was not stored.')
    const model = await parseDocx(edited)
    expect(
      model.model.stories.find(({ kind }) => kind === 'document')?.paragraphs[0]
        ?.runs[0]?.text,
    ).toBe('Edited synthetic text')

    expect(database.audits.map(({ action }) => action)).toEqual([
      'document.version_create',
      'document.edit',
    ])
    expect(database.transactionCommands).toEqual(['begin', 'commit'])
    expect(JSON.stringify(database.audits)).not.toContain(
      'Edited synthetic text',
    )
    expect(JSON.stringify(database.audits)).not.toContain('<w:')
  })

  it('rechecks document existence under the transaction lock', async () => {
    const database = new EditDatabase({ transactionDocumentMissing: true })
    const { app, storage } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    await expectDocument404(response)
    expect(storage.reads).toEqual([sourceKey])
    expect(storage.writes).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
  })

  it('serialises concurrent saves so one creates N+1 and one receives 409', async () => {
    const database = new EditDatabase()
    const storage = new EditStorage()
    let releaseReads: () => void = () => undefined
    storage.readGate = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const { app } = routeApp(database, storage)

    const first = app.request(
      '/api/documents/doc_1/edit',
      editRequest('ver_1', 'First edit'),
    )
    const second = app.request(
      '/api/documents/doc_1/edit',
      editRequest('ver_1', 'Second edit'),
    )
    await waitFor(() => storage.reads.length === 2)
    releaseReads()
    const responses = await Promise.all([first, second])

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(
      database.transactionCommands.filter((item) => item === 'commit'),
    ).toHaveLength(1)
    expect(
      database.transactionCommands.filter((item) => item === 'rollback'),
    ).toHaveLength(1)
  })

  it('pins the locked recheck before the conditional current-pointer update', async () => {
    const database = new EditDatabase()
    const response = await routeApp(database).app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(201)
    const lockIndex = database.queries.findIndex((sql) =>
      sql.includes('for update of document'),
    )
    const pointerIndex = database.queries.findIndex((sql) =>
      sql.includes('update matter_documents'),
    )
    expect(lockIndex).toBeGreaterThan(-1)
    expect(pointerIndex).toBeGreaterThan(lockIndex)
    expect(database.queries[pointerIndex]).toContain('current_version_id = $4')
  })

  it('rolls back rows and removes the candidate object when audit insertion fails', async () => {
    const database = new EditDatabase({ auditFailure: true })
    const { app, storage, errors } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(storage.writes).toHaveLength(1)
    expect(storage.deletes).toEqual(storage.writes)
    expect(storage.binary.size).toBe(1)
    expect(errors).toEqual(['The edited document could not be stored.'])
  })

  it('keeps the candidate after a client-side commit-response failure', async () => {
    const database = new EditDatabase({ commitResponseFailure: true })
    const { app, storage, errors } = routeApp(database)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(500)
    expect(database.currentVersionId).not.toBe('ver_1')
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(database.transactionCommands).toEqual(['begin', 'commit'])
    expect(storage.writes).toHaveLength(1)
    expect(storage.deletes).toEqual([])
    expect(storage.binary.has(storage.writes[0] ?? '')).toBe(true)
    expect(errors).toEqual(['The edited document could not be stored.'])
  })

  it('keeps database state rolled back when compensating cleanup fails', async () => {
    const database = new EditDatabase({ auditFailure: true })
    const storage = new EditStorage()
    storage.deleteFailure = true
    const { app, errors } = routeApp(database, storage)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(500)
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(errors).toEqual(['The edited document could not be stored.'])
    expect(JSON.stringify(errors)).not.toContain('private cleanup diagnostic')
  })

  it('cleans up a partial storage write and exposes no provider diagnostic', async () => {
    const database = new EditDatabase()
    const storage = new EditStorage()
    storage.writeFailure = true
    const { app, errors } = routeApp(database, storage)
    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'storage_unavailable',
        message: 'The API could not complete the request.',
        requestId: 'req_edit',
      },
    })
    expect(database.versions.size).toBe(1)
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.audits).toEqual([])
    expect(storage.deletes).toEqual(storage.writes)
    expect(storage.binary.size).toBe(1)
    expect(JSON.stringify(errors)).not.toContain('private write diagnostic')
  })
})

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for concurrent edit preparation.')
}
