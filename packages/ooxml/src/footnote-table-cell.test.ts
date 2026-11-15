import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { createBlankDocx } from './blank'
import { canonicaliseParagraphIdentities, createLineageRecorder } from './index'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}

describe('footnote in a new table cell', () => {
  it('keeps footnote part ids unique across parts and reparses', async () => {
    const document = await parseDocx(await createBlankDocx())
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_table',
        paragraphId: anchor.id,
        rows: 1,
        columns: 1,
        cellEdits: [{ row: 0, column: 0, text: 'Cell text' }],
      },
    ])
    const tableBytes = await serialiseDocx(document)
    const reparsed = await parseDocx(tableBytes)
    const cell = mainParagraphs(reparsed).find((p) =>
      p.id.startsWith('para-w14-E6'),
    )
    expect(cell).toBeDefined()

    const recorder = createLineageRecorder(reparsed.model)
    applyDocumentEdits(
      reparsed,
      [
        {
          type: 'insert_footnote',
          paragraphId: cell!.id,
          offset: 0,
          text: '',
        },
      ],
      undefined,
      recorder,
    )
    canonicaliseParagraphIdentities(reparsed)
    const output = await serialiseDocx(reparsed)

    const zip = await JSZip.loadAsync(output)
    const notes = await zip.file('word/footnotes.xml')?.async('string')
    expect(notes).toBeDefined()
    expect(notes!.endsWith('</w:footnotes>')).toBe(true)

    const final = await parseDocx(output)
    const footnotes = final.model.stories.find(
      (story) => story.kind === 'footnotes',
    )
    expect(footnotes?.paragraphs.length).toBeGreaterThan(0)
    const ids = new Set(
      final.model.stories.flatMap((story) =>
        story.paragraphs.map((p) => p.sourceParaId),
      ),
    )
    expect(ids.size).toBe(
      final.model.stories.reduce((n, s) => n + s.paragraphs.length, 0),
    )
  })
})
