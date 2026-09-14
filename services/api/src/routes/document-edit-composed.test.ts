import { describe, expect, it } from 'vitest'
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
const sourceParagraph = sourceStory?.paragraphs[0]
if (!sourceParagraph) throw new Error('Edit fixture has no body paragraph.')
const sourceRunIndex = sourceParagraph.runs.findIndex(
  (run) => run.text.length > 0,
)
const sourceRun = sourceParagraph.runs[sourceRunIndex]
if (!sourceRun) {
  throw new Error('Edit fixture has no ordinary text run.')
}
const paragraphId = sourceParagraph.id
const runId = sourceRun.id
const prefix = sourceParagraph.runs
  .slice(0, sourceRunIndex)
  .map((run) => run.text)
  .join('')
const suffix = sourceParagraph.runs
  .slice(sourceRunIndex + 1)
  .map((run) => run.text)
  .join('')
const typed = `${sourceRun.text} tailword`
const tailFrom = prefix.length + sourceRun.text.length + 1
const tailTo = prefix.length + typed.length

// E44 API leg: typed text and the emphasis on it arrive as two operations in
// one request. The pair used to be rejected as an invalid document edit; the
// version must now be written atomically with both effects.
describe('POST /api/documents/:id/edit typed text plus formatting', () => {
  it('saves the typed text and its emphasis in one immutable version', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      composedRequest(),
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
    expect(paragraph.runs.map((run) => run.text).join('')).toBe(
      `${prefix}${typed}${suffix}`,
    )
    expect(
      paragraph.runs
        .filter((run) =>
          /<w:u\b(?![^>]*w:val="0")/u.test(run.preservedXmlFragments.join('')),
        )
        .map((run) => run.text)
        .join(''),
    ).toBe('tailword')
    expect(database.audits.map(({ action }) => action)).toContain(
      'document.edit',
    )
  })

  it('persists nothing when the composed payload fails validation', async () => {
    const database = new EditDatabase()
    const { app, storage } = routeApp(database)

    const response = await app.request(
      '/api/documents/doc_1/edit',
      composedRequest({ from: tailTo, to: tailFrom }),
    )

    expect(response.status).toBe(400)
    expect(database.versions.size).toBe(1)
    expect(storage.writes).toEqual([])
  })
})

function composedRequest(
  range: { from: number; to: number } = { from: tailFrom, to: tailTo },
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId: 'ver_1',
      operations: [
        { type: 'replace_run_text', runId, text: typed },
        {
          type: 'set_run_emphasis',
          paragraphId,
          from: range.from,
          to: range.to,
          underline: true,
        },
      ],
    }),
  }
}
