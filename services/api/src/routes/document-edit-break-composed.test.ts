import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '@obiter/ooxml'
import {
  EditDatabase,
  EditStorage,
  routeApp,
  sourceKey,
} from './document-edit.test-support'

// E44 review finding 1, API leg: a run that mixes text with a page break is a
// shape imported documents produce. Typing into it and emphasising the typed
// text used to be rejected with 400; it must now write one immutable version
// with the break preserved.
const sourceBytes = await readFile('../../data/evals/redact/demo-fixture.docx')
const bodyXml =
  '<w:body><w:p>' +
  '<w:r><w:t>ab</w:t><w:br w:type="page"/><w:t>cd</w:t></w:r>' +
  '</w:p></w:body>'

const breakBytes = await withBody(sourceBytes, bodyXml)
const breakModel = await parseDocx(breakBytes)
const breakParagraph = breakModel.model.stories.find(
  ({ kind }) => kind === 'document',
)?.paragraphs[0]
const paragraphId = breakParagraph?.id
const runId = breakParagraph?.runs[0]?.id
if (!paragraphId || !runId) throw new Error('Break fixture has no text run.')

// E57: the same shape with a text-wrapping break, which occupies one `\n` in
// the paragraph text rather than none.
const wrappingXml =
  '<w:body><w:p>' +
  '<w:r><w:t>ab</w:t><w:br/><w:t>cdef</w:t></w:r>' +
  '</w:p></w:body>'
const wrappingBytes = await withBody(sourceBytes, wrappingXml)
const wrappingModel = await parseDocx(wrappingBytes)
const wrappingParagraph = wrappingModel.model.stories.find(
  ({ kind }) => kind === 'document',
)?.paragraphs[0]
const wrappingParagraphId = wrappingParagraph?.id
const wrappingRunId = wrappingParagraph?.runs[0]?.id
if (!wrappingParagraphId || !wrappingRunId) {
  throw new Error('Wrapping fixture has no text run.')
}

async function documentXmlOf(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Saved package has no word/document.xml.')
  return entry.async('string')
}

async function withBody(source: Buffer, body: string) {
  const zip = await JSZip.loadAsync(source)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Fixture has no word/document.xml.')
  const xml = (await entry.async('string')).replace(
    /<w:body>[\s\S]*<\/w:body>/u,
    body,
  )
  zip.file('word/document.xml', xml)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

describe('POST /api/documents/:id/edit on a run with a page break', () => {
  it('saves the typed text and its emphasis with the break intact', async () => {
    const database = new EditDatabase({
      sizeBytes: String(breakBytes.byteLength),
    })
    const storage = new EditStorage()
    storage.binary.set(sourceKey, breakBytes)
    const { app } = routeApp(database, storage)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest({ paragraphId, runId }, 'abXYcd', { from: 2, to: 6 }),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { versionId: string }
    expect(database.versions.size).toBe(2)
    const version = database.versions.get(body.versionId)
    const edited = storage.binary.get(version?.object_key ?? '')
    if (!edited) throw new Error('Edited source was not stored.')

    const saved = await parseDocx(edited)
    const paragraph = saved.model.stories.find(
      ({ kind }) => kind === 'document',
    )?.paragraphs[0]
    if (!paragraph) throw new Error('Saved paragraph is missing.')
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('abXYcd')
    expect(
      paragraph.runs
        .filter((run) =>
          /<w:b\b(?![^>]*w:val="0")/u.test(run.preservedXmlFragments.join('')),
        )
        .map((run) => run.text)
        .join(''),
    ).toBe('XYcd')
    const xml = await documentXmlOf(edited)
    expect(xml.split('<w:br w:type="page"/>').length - 1).toBe(1)
    expect(xml.split('<w:br/>').length - 1).toBe(0)
    expect(database.audits.map(({ action }) => action)).toContain(
      'document.edit',
    )
  })

  it('persists nothing when the same composed payload is invalid', async () => {
    const database = new EditDatabase({
      sizeBytes: String(breakBytes.byteLength),
    })
    const storage = new EditStorage()
    storage.binary.set(sourceKey, breakBytes)
    const { app } = routeApp(database, storage)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest({ paragraphId, runId }, 'abXYcd', { from: 5, to: 2 }),
    )

    expect(response.status).toBe(400)
    expect(database.versions.size).toBe(1)
    expect(storage.writes).toEqual([])
  })
})

describe('POST /api/documents/:id/edit on a run with a text-wrapping break', () => {
  it('saves emphasis on the characters after the break, with the break once', async () => {
    const database = new EditDatabase({
      sizeBytes: String(wrappingBytes.byteLength),
    })
    const storage = new EditStorage()
    storage.binary.set(sourceKey, wrappingBytes)
    const { app } = routeApp(database, storage)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(
        { paragraphId: wrappingParagraphId, runId: wrappingRunId },
        'ab\ncdef',
        { from: 4, to: 6 },
      ),
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as { versionId: string }
    expect(database.versions.size).toBe(2)
    const version = database.versions.get(body.versionId)
    const edited = storage.binary.get(version?.object_key ?? '')
    if (!edited) throw new Error('Edited source was not stored.')

    const saved = await parseDocx(edited)
    const paragraph = saved.model.stories.find(
      ({ kind }) => kind === 'document',
    )?.paragraphs[0]
    if (!paragraph) throw new Error('Saved paragraph is missing.')
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(
      paragraph.runs
        .filter((run) =>
          /<w:b\b(?![^>]*w:val="0")/u.test(run.preservedXmlFragments.join('')),
        )
        .map((run) => run.text)
        .join(''),
    ).toBe('de')
    const xml = await documentXmlOf(edited)
    expect(xml.split('<w:br/>').length - 1).toBe(1)
  })

  it('persists nothing when the same composed payload is invalid', async () => {
    const database = new EditDatabase({
      sizeBytes: String(wrappingBytes.byteLength),
    })
    const storage = new EditStorage()
    storage.binary.set(sourceKey, wrappingBytes)
    const { app } = routeApp(database, storage)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      editRequest(
        { paragraphId: wrappingParagraphId, runId: wrappingRunId },
        'ab\ncdef',
        { from: 0, to: 500 },
      ),
    )

    expect(response.status).toBe(400)
    expect(database.versions.size).toBe(1)
    expect(storage.writes).toEqual([])
  })
})

function editRequest(
  ids: { paragraphId: string; runId: string },
  text: string,
  range: { from: number; to: number },
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId: 'ver_1',
      operations: [
        { type: 'replace_run_text', runId: ids.runId, text },
        {
          type: 'set_run_emphasis',
          paragraphId: ids.paragraphId,
          from: range.from,
          to: range.to,
          bold: true,
        },
      ],
    }),
  }
}
