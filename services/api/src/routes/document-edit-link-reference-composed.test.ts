import JSZip from 'jszip'
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
const sourceParagraphs = sourceStory?.paragraphs ?? []
const linkParagraph = sourceParagraphs[0]
const referenceParagraph = sourceParagraphs[1]
const referenceTarget = sourceParagraphs[2]
if (!linkParagraph || !referenceParagraph || !referenceTarget) {
  throw new Error('Edit fixture is missing body paragraphs.')
}
const linkTo = Math.min(
  4,
  linkParagraph.runs.map((run) => run.text).join('').length,
)
const referenceOffset = Math.min(
  2,
  referenceParagraph.runs.map((run) => run.text).join('').length,
)

// E6b API leg: a hyperlink range and a REF field arrive as two operations in
// one request, and the persisted version carries both — the relationship and
// the bookmark — through the same validation the typed edits take.
describe('POST /api/documents/:id/edit hyperlinks and cross-references', () => {
  it('saves the hyperlink and the cross-reference in one version', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      composedRequest(),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { versionId: string }
    const version = database.versions.get(body.versionId)
    const edited = storage.binary.get(version?.object_key ?? '')
    if (!edited) throw new Error('Edited source was not stored.')

    const zip = await JSZip.loadAsync(edited)
    const xml = await zip.file('word/document.xml')?.async('string')
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
    if (!xml || !rels) throw new Error('Saved package is incomplete.')

    const link = xml.match(/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/u)?.[0]
    expect(link).toBeDefined()
    const relId = /r:id="(rId\d+)"/u.exec(link ?? '')?.[1]
    expect(rels).toContain(`Id="${relId ?? ''}"`)
    expect(rels).toContain('Target="https://example.co.uk/authority"')
    expect(rels).toContain('TargetMode="External"')
    expect(xml).toMatch(/<w:instrText[^>]*>\s*REF _Ref_/u)
    expect(xml).toMatch(/<w:bookmarkStart[^>]*w:name="_Ref_/u)

    // The link text itself is untouched: the mark wraps, it never inserts.
    const saved = await parseDocx(edited)
    const savedStory = saved.model.stories.find(
      ({ kind }) => kind === 'document',
    )
    expect(
      savedStory?.paragraphs[0]?.runs.map((run) => run.text).join(''),
    ).toBe(linkParagraph.runs.map((run) => run.text).join(''))
    expect(database.audits.map(({ action }) => action)).toContain(
      'document.edit',
    )
  })

  it('persists nothing when the target fails contract validation', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      composedRequest('javascript:alert(1)'),
    )

    expect(response.status).toBe(400)
    expect(database.versions.size).toBe(1)
    expect(storage.writes).toEqual([])
  })
})

function composedRequest(target = 'https://example.co.uk/authority') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId: 'ver_1',
      operations: [
        {
          type: 'set_hyperlink',
          paragraphId: linkParagraph.id,
          from: 0,
          to: linkTo,
          target,
        },
        {
          type: 'insert_cross_reference',
          paragraphId: referenceParagraph.id,
          offset: referenceOffset,
          targetParagraphId: referenceTarget.id,
        },
      ],
    }),
  }
}
