import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'
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
const directChildPropertySourceBytes = await replaceDocumentXml(
  sourceBytes,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPrChange w:id="91"><w:pPr><w:pStyle w:val="old"/></w:pPr></w:pPrChange><w:r><w:t>Text that must survive</w:t></w:r></w:p></w:body></w:document>',
)
const soleMarkDeletionSourceBytes = await replaceDocumentXml(
  sourceBytes,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:rPr><w:del w:id="90" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"/></w:rPr></w:pPr></w:p></w:body></w:document>',
)
const soleInsertShellSourceBytes = await replaceDocumentXml(
  sourceBytes,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="92" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Typed</w:t></w:r></w:ins></w:p></w:body></w:document>',
)
const insertShellAfterKeepSourceBytes = await replaceDocumentXml(
  sourceBytes,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep</w:t></w:r></w:p><w:p><w:ins w:id="92" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Typed</w:t></w:r></w:ins></w:p></w:body></w:document>',
)
const insertShellTwoInsertsSourceBytes = await replaceDocumentXml(
  sourceBytes,
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep</w:t></w:r></w:p><w:p><w:ins w:id="92" w:author="Foreign Reviewer" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Typed</w:t></w:r></w:ins><w:ins w:id="93" w:author="Foreign Reviewer" w:date="2026-08-10T10:01:00Z"><w:r><w:t>Also typed</w:t></w:r></w:ins></w:p></w:body></w:document>',
)
const sourceDocument = await parseDocx(trackedSourceBytes)
const insertion = sourceDocument.model.changes.find(
  ({ elementName }) => elementName === 'ins',
)
const deletion = sourceDocument.model.changes.find(
  ({ elementName }) => elementName === 'del',
)
const moveFrom = sourceDocument.model.changes.find(
  ({ elementName }) => elementName === 'moveFrom',
)
if (!insertion || !deletion || !moveFrom?.pairId)
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
    expect(route.errors).toEqual(['The tracked changes could not be read.'])
  })

  it('fails closed before creating a version for a direct-child property change', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(
      database,
      undefined,
      undefined,
      directChildPropertySourceBytes,
    )
    const crafted = await parseDocx(directChildPropertySourceBytes)
    const change = crafted.model.changes.find(
      ({ elementName }) => elementName === 'pPrChange',
    )
    if (!change) throw new Error('Crafted property change is missing.')

    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('reject', change.id),
    )

    expect(response.status).toBe(400)
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(route.storage.writes).toEqual([])
    const unchanged = route.storage.binary.get(sourceKey)
    if (!unchanged) throw new Error('Crafted source was not retained.')
    expect(
      (await parseDocx(unchanged)).model.stories.find(
        ({ kind }) => kind === 'document',
      )?.paragraphs[0]?.runs[0]?.text,
    ).toBe('Text that must survive')
  })

  it('refuses accepting the only paragraph mark deletion without a version', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(
      database,
      undefined,
      undefined,
      soleMarkDeletionSourceBytes,
    )
    const crafted = await parseDocx(soleMarkDeletionSourceBytes)
    const change = crafted.model.changes.find(
      ({ elementName }) => elementName === 'del',
    )
    if (!change) throw new Error('Crafted paragraph-mark deletion is missing.')

    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', change.id),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    // Accepting the mark would persist an empty body, so nothing is committed.
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(route.storage.writes).toEqual([])
  })

  it('refuses rejecting the only tracked-insert shell without a version', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(
      database,
      undefined,
      undefined,
      soleInsertShellSourceBytes,
    )
    const crafted = await parseDocx(soleInsertShellSourceBytes)
    const paragraphId = crafted.model.stories.find(
      ({ kind }) => kind === 'document',
    )?.paragraphs[0]?.id
    const insert = crafted.model.changes.find(
      ({ elementName }) => elementName === 'ins',
    )
    if (!paragraphId || !insert) {
      throw new Error('Crafted tracked-insert shell is missing.')
    }

    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseVersionId: 'ver_1',
          action: 'reject',
          changeIds: [insert.id],
          removeParagraphIds: [paragraphId],
        }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    // Rejecting the shell would remove the only paragraph, so nothing commits.
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(route.storage.writes).toEqual([])
  })

  it('accepts every pending change in one atomic decision version', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(database)
    const allIds = sourceDocument.model.changes.map(({ id }) => id)
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      decisionRequest('accept', '', allIds),
    )
    const body = (await response.json()) as {
      versionId: string
      versionNumber: number
    }

    // One request, one immutable version, every change applied inside it.
    expect(response.status).toBe(201)
    expect(body.versionNumber).toBe(2)
    expect(database.versions.size).toBe(2)
    expect(database.transactionCommands).toEqual(['begin', 'commit'])
    const version = database.versions.get(body.versionId)
    const source = route.storage.binary.get(version?.object_key ?? '')
    if (!source) throw new Error('Decision source was not stored.')
    const reparsed = await parseDocx(source)
    expect(reparsed.model.changes).toEqual([])
    const xml = await (
      await JSZip.loadAsync(source)
    )
      .file('word/document.xml')
      ?.async('string')
    expect(xml).toContain('Inserted review text')
    expect(xml).not.toContain('<w:ins')
    expect(xml).not.toContain('<w:del ')
    expect(xml).not.toContain('PrChange')
    // The base version's bytes are untouched.
    expect(route.storage.binary.get(sourceKey)).toEqual(trackedSourceBytes)
  })

  it('removes an empty tracked-insert shell inside an atomic rejection', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(
      database,
      undefined,
      undefined,
      insertShellAfterKeepSourceBytes,
    )
    const crafted = await parseDocx(insertShellAfterKeepSourceBytes)
    const shell = crafted.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.find(({ runs }) => runs.length === 0)
    const insert = crafted.model.changes.find(
      ({ elementName }) => elementName === 'ins',
    )
    if (!shell || !insert) {
      throw new Error('Crafted tracked-insert shell is missing.')
    }

    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseVersionId: 'ver_1',
          action: 'reject',
          changeIds: [insert.id],
          removeParagraphIds: [shell.id],
        }),
      },
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { versionId: string }
    const version = database.versions.get(body.versionId)
    const source = route.storage.binary.get(version?.object_key ?? '')
    if (!source) throw new Error('Decision source was not stored.')
    const reparsed = await parseDocx(source)
    const paragraphs = reparsed.model.stories.find(
      ({ kind }) => kind === 'document',
    )?.paragraphs
    expect(
      paragraphs?.map((item) => item.runs.map(({ text }) => text).join('')),
    ).toEqual(['Keep'])
    expect(reparsed.model.changes).toEqual([])
  })

  it('refuses a shell removal that would strand an undecided change', async () => {
    const database = new EditDatabase()
    const route = trackedRouteApp(
      database,
      undefined,
      undefined,
      insertShellTwoInsertsSourceBytes,
    )
    const crafted = await parseDocx(insertShellTwoInsertsSourceBytes)
    const shell = crafted.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.find(({ runs }) => runs.length === 0)
    const inserts = crafted.model.changes.filter(
      ({ elementName }) => elementName === 'ins',
    )
    if (!shell || inserts.length !== 2 || !inserts[0]) {
      throw new Error('Crafted two-insert shell is missing.')
    }

    // Rejecting the first insert and naming the shell would delete the
    // second insert's markup without a decision — refuse and write nothing.
    const response = await route.app.request(
      '/api/documents/doc_1/tracked-changes/decision',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseVersionId: 'ver_1',
          action: 'reject',
          changeIds: [inserts[0].id],
          removeParagraphIds: [shell.id],
        }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed' },
    })
    expect(database.currentVersionId).toBe('ver_1')
    expect(database.versions.size).toBe(1)
    expect(database.audits).toEqual([])
    expect(route.storage.writes).toEqual([])
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
      ['accept', moveFrom],
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
        changeIds:
          selected.kind === 'move' ? [changeId, selected.pairId] : [changeId],
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
  source = trackedSourceBytes,
) {
  storage.binary.set(sourceKey, source)
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

async function replaceDocumentXml(source: Uint8Array, xml: string) {
  const zip = await JSZip.loadAsync(source)
  zip.file('word/document.xml', xml)
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
