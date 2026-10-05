import { describe, expect, it } from 'bun:test'
import { parseDocx } from '@obiter/ooxml'
import {
  EditDatabase,
  routeApp,
  sourceBytes,
} from './document-edit.test-support'

const sourceModel = await parseDocx(sourceBytes)
const sourceStory = sourceModel.model.stories.find(
  ({ kind }) => kind === 'document',
)
const paragraph = sourceStory?.paragraphs.find((item) => item.runs.length > 0)
if (!paragraph) throw new Error('Edit fixture has no body paragraph.')
const paragraphId = paragraph.id

// E5 API leg: page setup and a break arrive as one atomic batch and the version
// must carry the section properties and both breaks.
describe('POST /api/documents/:id/edit page setup and breaks', () => {
  it('writes section properties and both breaks in one version', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { versionId: string }
    const version = database.versions.get(body.versionId)
    const edited = storage.binary.get(version?.object_key ?? '')
    if (!edited) throw new Error('Edited source was not stored.')

    const saved = await parseDocx(edited)
    const documentStory = saved.model.stories.find(
      ({ kind }) => kind === 'document',
    )
    const storyXml = (documentStory?.preservedXmlFragments ?? []).join('')
    expect(storyXml).toContain('<w:pgMar w:top="720"')
    const breakFound = (documentStory?.paragraphs ?? []).some((item) =>
      [
        ...item.preservedXmlFragments,
        ...item.runs.flatMap((run) => run.preservedXmlFragments),
      ]
        .join('')
        .includes('<w:br w:type="page"/>'),
    )
    expect(breakFound).toBe(true)
    const sectionBreakFound = (documentStory?.paragraphs ?? []).some((item) =>
      item.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:sectPr'),
      ),
    )
    expect(sectionBreakFound).toBe(true)
    expect(database.audits.map(({ action }) => action)).toContain(
      'document.edit',
    )
  })

  it('persists nothing when the batch fails validation', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest({ offset: 9_999 }),
    )

    expect(response.status).toBe(400)
    expect(database.versions.size).toBe(1)
    expect(storage.writes).toEqual([])
  })
})

function editRequest({ offset = 0 }: { offset?: number } = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId: 'ver_1',
      operations: [
        { type: 'set_section_properties', margins: { top: 720 } },
        { type: 'insert_break', paragraphId, offset, kind: 'page' },
        { type: 'insert_section_break', paragraphId },
      ],
    }),
  }
}
