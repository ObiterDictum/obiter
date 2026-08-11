import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  documentTrackedChangeListResponseSchema,
  type DocumentTrackedChangeDecisionRequest,
} from '@obiter/contracts'
import { parseDocx } from '@obiter/ooxml'
import { createTrackedChangeRoutes } from './tracked-changes'
import {
  EditDatabase,
  EditStorage,
  expectDocument404,
  sourceBytes,
  sourceKey,
} from './document-edit.test-support'
import { createRouteApp } from './document-route.test-support'

const trackedSourceBytes = await addTrackedChanges(sourceBytes)
const sourceDocument = await parseDocx(trackedSourceBytes)
const insertion = sourceDocument.model.changes.find(
  ({ elementName }) => elementName === 'ins',
)
const deletion = sourceDocument.model.changes.find(
  ({ elementName }) => elementName === 'del',
)
if (!insertion || !deletion)
  throw new Error('Tracked test changes are missing.')

describe('tracked change routes', () => {
  it('lists the selected ready version for a view grantee without using model cache', async () => {
    const database = new EditDatabase({ access: 'view' })
    const route = trackedRouteApp(database)
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes?versionId=ver_1',
    )
    const body = documentTrackedChangeListResponseSchema.parse(
      await response.json(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
    })
    expect(body.changes.map(({ elementName }) => elementName)).toEqual([
      'ins',
      'del',
      'moveFrom',
      'moveTo',
      'pPrChange',
      'rPrChange',
    ])
    expect(route.storage.binaryReads).toEqual([sourceKey])
    expect(route.storage.textReads).toEqual([])
    expect(JSON.stringify(body)).not.toContain('sourceFragment')
    expect(JSON.stringify(body)).not.toContain('objectKey')
  })

  it('authenticates and resolves document access before source reads', async () => {
    const unauthenticated = trackedRouteApp(new EditDatabase(), null)
    const authResponse = await unauthenticated.app.request(
      '/api/documents/doc_1/tracked-changes',
    )
    expect(authResponse.status).toBe(401)
    expect(authResponse.headers.get('cache-control')).toBe('no-store')
    expect(unauthenticated.storage.binaryReads).toEqual([])

    for (const documentId of ['doc_unknown', 'doc_cross', 'doc_deleted']) {
      const route = trackedRouteApp(new EditDatabase())
      const response = await route.app.request(
        `/api/documents/${documentId}/tracked-changes`,
      )
      await expectDocument404(response)
      expect(route.storage.binaryReads).toEqual([])
    }
  })

  it('keeps parser and storage diagnostics behind the generic boundary', async () => {
    const route = trackedRouteApp(new EditDatabase({ access: 'view' }))
    route.storage.binary.set(
      sourceKey,
      Buffer.from('PK private tracked-change parser diagnostic'),
    )
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes',
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('private tracked-change')
    expect(route.errors).toEqual(['The edited document could not be stored.'])
  })

  it('returns the uniform 404 for an unknown selected version', async () => {
    const route = trackedRouteApp(new EditDatabase({ access: 'view' }))
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes?versionId=ver_unknown',
    )

    await expectDocument404(response)
    expect(route.storage.binaryReads).toEqual([])
  })

  it('allows an edit grantee to accept or reject into immutable N+1 versions', async () => {
    for (const [action, selected] of [
      ['accept', insertion],
      ['reject', deletion],
    ] as const) {
      const changeId = selected.id
      const database = new EditDatabase()
      const route = trackedRouteApp(database)
      const response = await route.app.request(
        '/api/documents/doc_1/tracked-changes/decision',
        decisionRequest(action, changeId),
      )
      const body = (await response.json()) as {
        documentId: string
        versionId: string
        versionNumber: number
      }

      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body).toMatchObject({ documentId: 'doc_1', versionNumber: 2 })
      expect(database.currentVersionId).toBe(body.versionId)
      expect(database.versions.size).toBe(2)
      expect(route.storage.binary.get(sourceKey)).toEqual(trackedSourceBytes)
      const version = database.versions.get(body.versionId)
      const source = route.storage.binary.get(version?.object_key ?? '')
      if (!source) throw new Error('Decision source was not stored.')
      const changes = (await parseDocx(source)).model.changes
      expect(changes.some(({ ooxmlId }) => ooxmlId === selected.ooxmlId)).toBe(
        false,
      )
      expect(
        database.audits.map(({ action: auditAction }) => auditAction),
      ).toEqual([
        'document.version_create',
        `document.tracked_change_${action}`,
      ])
      const audit = database.audits[1]
      expect(audit?.metadata).toEqual({
        documentId: 'doc_1',
        baseVersionId: 'ver_1',
        newVersionId: body.versionId,
        action,
        changeIds: [changeId],
      })
      expect(JSON.stringify(database.audits)).not.toContain(insertion.author)
      expect(JSON.stringify(database.audits)).not.toContain(insertion.text)
      expect(database.transactionCommands).toEqual(['begin', 'commit'])
    }
  })

  it('denies a view grantee before decision validation or storage access', async () => {
    const route = trackedRouteApp(new EditDatabase({ access: 'view' }))
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', ''),
    )

    await expectDocument404(response)
    expect(route.storage.binaryReads).toEqual([])
  })

  it('rejects duplicate identifiers and a stale base without creating a version', async () => {
    const duplicate = trackedRouteApp(new EditDatabase())
    const invalid = await duplicate.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', insertion.id, [insertion.id, insertion.id]),
    )
    expect(invalid.status).toBe(400)
    expect(duplicate.storage.binaryReads).toEqual([])

    const stale = trackedRouteApp(new EditDatabase())
    const response = await stale.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', insertion.id, undefined, 'ver_stale'),
    )
    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(stale.storage.binaryReads).toEqual([])
    expect(stale.database.versions.size).toBe(1)
  })

  it('serialises concurrent decisions so only one creates N+1', async () => {
    const database = new EditDatabase()
    const storage = new EditStorage()
    let releaseReads: () => void = () => undefined
    storage.readGate = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const route = trackedRouteApp(database, undefined, storage)

    const first = route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', insertion.id),
    )
    const second = route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('reject', deletion.id),
    )
    await waitFor(() => storage.binaryReads.length === 2)
    releaseReads()
    const responses = await Promise.all([first, second])

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(database.versions.size).toBe(2)
    expect(database.audits).toHaveLength(2)
    expect(
      database.queries.some((sql) => sql.includes('for update of document')),
    ).toBe(true)
  })

  it('rolls back both audits and removes the candidate object on failure', async () => {
    const database = new EditDatabase({ auditFailure: true })
    const route = trackedRouteApp(database)
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', insertion.id),
    )

    expect(response.status).toBe(500)
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(database.transactionCommands).toEqual(['begin', 'rollback'])
    expect(route.storage.deletes).toEqual(route.storage.writes)
    expect(route.errors).toEqual(['The edited document could not be stored.'])
  })
})

function trackedRouteApp(
  database: EditDatabase,
  user:
    | {
        id: string
        name?: string
        organisationId: string | null
        role: 'owner' | 'admin' | 'member' | null
      }
    | null
    | undefined = {
    id: 'usr_editor',
    name: 'Session Reviewer',
    organisationId: 'org_1',
    role: 'member',
  },
  storage = new EditStorage(),
) {
  storage.binary.set(sourceKey, trackedSourceBytes)
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_tracked',
      createRoutes: createTrackedChangeRoutes,
    }),
    database,
    storage,
  }
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for concurrent decision preparation.')
}

async function addTrackedChanges(source: Uint8Array) {
  const zip = await JSZip.loadAsync(source)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Test document story is missing.')
  const xml = await entry.async('string')
  const changes =
    '<w:ins w:id="10" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Inserted review text</w:t></w:r></w:ins><w:del w:id="11" w:author="Foreign Reviewer" w:date="2026-08-10T10:01:00Z"><w:r><w:delText>Deleted review text</w:delText></w:r></w:del><w:moveFrom w:id="12"><w:r><w:delText>Moved from</w:delText></w:r></w:moveFrom><w:moveTo w:id="12"><w:r><w:t>Moved to</w:t></w:r></w:moveTo><w:pPr><w:pPrChange w:id="13"><w:pPr/></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="14"><w:rPr/></w:rPrChange></w:rPr><w:t>Property review</w:t></w:r>'
  zip.file(
    'word/document.xml',
    xml.replace(/(<w:p(?:\s[^>]*)?>)/u, `$1${changes}`),
  )
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

function decisionRequest(
  action: DocumentTrackedChangeDecisionRequest['action'],
  changeId: string,
  changeIds?: string[],
  baseVersionId = 'ver_1',
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId,
      action,
      changeIds: changeIds ?? [changeId],
    }),
  }
}
