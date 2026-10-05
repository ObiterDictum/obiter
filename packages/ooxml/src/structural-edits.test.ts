import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import type { DocumentEditOperation } from '@obiter/contracts'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  parseDocx,
  reconcileDocumentEdits,
  serialiseDocx,
} from './index'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (char) =>
  char.charCodeAt(0),
)

describe('structural edits', () => {
  it('inserts a bordered table whose cells carry unique paragraph ids', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const following = paragraphs[1]
    if (!anchor || !following) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 2, columns: 3 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const table = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/u)?.[0] ?? ''
    expect(table).toContain('<w:tblBorders>')
    expect(table.match(/<w:tr>/gu)).toHaveLength(2)
    expect(table.match(/<w:tc>/gu)).toHaveLength(6)
    // Every cell ends in a `w:p` with a `w14:paraId`, the OOXML cell rule the
    // reader binds wires by.
    const cellParaIds = [
      ...table.matchAll(/w14:paraId="([0-9A-Fa-f]{8})"/gu),
    ].map((match) => match[1])
    expect(new Set(cellParaIds).size).toBe(6)

    const reparsed = mainParagraphs(await parseDocx(output))
    const anchorIndex = reparsed.findIndex(
      (paragraph) => paragraph.id === anchor.id,
    )
    expect(anchorIndex).toBeGreaterThanOrEqual(0)
    // The cell wires splice between the anchor and the paragraph that
    // followed it, in row-major order, with `para-w14-` identities.
    const cells = reparsed.slice(anchorIndex + 1, anchorIndex + 7)
    expect(cells.map((paragraph) => paragraph.id)).toEqual(
      cellParaIds.map((id) => `para-w14-${id}`),
    )
    expect(reparsed[anchorIndex + 7]?.id).toBe(following.id)
    expect(
      document.model.stories
        .find((story) => story.kind === 'document')
        ?.preservedXmlFragments.some((fragment) => fragment.includes('<w:tbl')),
    ).toBe(true)
  })

  it('keeps a paragraph after a table inserted at the body end', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const last = paragraphs[paragraphs.length - 1]
    if (!last) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: last.id, rows: 1, columns: 2 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const bodyEnd = xml.slice(xml.lastIndexOf('</w:tbl>'))
    expect(bodyEnd).toContain('<w:p')

    const reparsed = mainParagraphs(await parseDocx(output))
    expect(reparsed.at(-1)?.runs).toHaveLength(0)
    expect(reparsed.at(-1)?.id.startsWith('para-w14-')).toBe(true)
  })

  it('separates a second table at one anchor and keeps operation order', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 1, columns: 1 },
      { type: 'insert_table', paragraphId: anchor.id, rows: 1, columns: 2 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const after = xml.slice(xml.indexOf('</w:p>') + '</w:p>'.length)
    const tables = [...after.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gu)]
    expect(tables.length).toBeGreaterThanOrEqual(2)
    // Adjacent `w:tbl` elements merge in Word, so the second insertion carries
    // an empty separator paragraph between them.
    const between = after.slice(
      (tables[0]?.index ?? 0) + (tables[0]?.[0].length ?? 0),
      tables[1]?.index,
    )
    expect(between).toContain('<w:p')
    expect((tables[0]?.[0].match(/<w:tc>/gu) ?? []).length).toBe(1)
    expect((tables[1]?.[0].match(/<w:tc>/gu) ?? []).length).toBe(2)
  })

  it('separates a new table from an existing one that follows the anchor', async () => {
    const document = await parseFixture()
    // The bookmark paragraph directly precedes the fixture's stored table.
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('Jane Example')),
    )
    if (!anchor) throw new Error('Fixture anchor is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 1, columns: 1 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const anchorEnd = xml.indexOf('Jane Example reference')
    const newTable = xml.indexOf('<w:tbl', anchorEnd)
    const storedTable = xml.indexOf('<w:tbl>', newTable + 1)
    expect(newTable).toBeGreaterThan(-1)
    expect(storedTable).toBeGreaterThan(newTable)
    expect(xml.slice(newTable, storedTable)).toContain('<w:p')
  })

  it('refuses a table anchored to a table cell', async () => {
    const document = await parseFixture()
    const cell = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Merged cell'),
    )
    if (!cell) throw new Error('Fixture cell is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table', paragraphId: cell.id, rows: 1, columns: 1 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('fails closed on structural insertion under tracked changes', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'insert_table', paragraphId: anchor.id, rows: 1, columns: 1 }],
        { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'insert_image',
            paragraphId: anchor.id,
            offset: 0,
            contentType: 'image/png',
            dataBase64: PNG_BASE64,
            widthPx: 10,
            heightPx: 10,
            name: 'Figure',
          },
        ],
        { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('inserts an image as a media part, relationship and inline drawing', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_image',
        paragraphId: anchor.id,
        offset: 6,
        contentType: 'image/png',
        dataBase64: PNG_BASE64,
        widthPx: 120,
        heightPx: 80,
        name: 'Figure "1" <draft>',
      },
    ])
    const output = await serialiseDocx(document)

    // The media part lands under word/media with the stored bytes.
    const zip = await JSZip.loadAsync(output)
    const media = zip.file('word/media/image2.png')
    if (!media) throw new Error('Inserted media part is missing.')
    expect(new Uint8Array(await media.async('arraybuffer'))).toEqual(PNG_BYTES)

    // The relationship joins the document part to the media part; png was
    // already a declared Default, so it is declared exactly once.
    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    const relationship = rels.match(
      /<Relationship[^>]*Target="media\/image2\.png"[^>]*\/>/u,
    )?.[0]
    expect(relationship).toContain('/relationships/image')
    const contentTypes = await zipText(output, '[Content_Types].xml')
    expect(contentTypes.match(/Extension="png"/gu)).toHaveLength(1)

    // The drawing is an inline extent in EMU with the escaped name.
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<wp:inline')
    expect(xml).toContain('cx="1143000" cy="762000"')
    expect(xml).toContain('name="Figure &quot;1&quot; &lt;draft&gt;"')
    const relId = /Id="(rId\d+)"[^>]*Target="media\/image2\.png"/u.exec(
      rels,
    )?.[1]
    expect(xml).toContain(`r:embed="${relId ?? 'missing'}"`)

    // A reparse reads the same shape: a zero-text drawing run the paint path
    // resolves through `paragraphImageXml`.
    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    const drawingRun = paragraph?.runs.find((run) =>
      run.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:drawing'),
      ),
    )
    expect(drawingRun?.text).toBe('')
  })

  it('rejects an out-of-range image offset and a surrogate split', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    const length = anchor.runs.map((run) => run.text).join('').length
    for (const offset of [length + 1, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        applyDocumentEdits(document, [
          {
            type: 'insert_image',
            paragraphId: anchor.id,
            offset,
            contentType: 'image/png',
            dataBase64: PNG_BASE64,
            widthPx: 10,
            heightPx: 10,
            name: 'Figure',
          },
        ]),
      ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    }
  })

  it('preserves unrelated package parts byte for byte', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 1, columns: 1 },
    ])
    const output = await serialiseDocx(document)
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const before = await JSZip.loadAsync(input)
    const after = await JSZip.loadAsync(output)
    for (const name of [
      'word/styles.xml',
      'word/numbering.xml',
      'word/media/image1.png',
    ]) {
      const original = before.file(name)
      const edited = after.file(name)
      if (!original || !edited) throw new Error(`Missing part ${name}.`)
      expect(await edited.async('uint8array')).toEqual(
        await original.async('uint8array'),
      )
    }
    // The stored table, sdt, tracked changes and fields all survive the
    // splice — only the new fragment was appended at the anchor's end.
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('Merged cell')
    expect(xml).toContain('w:sdt')
    expect(xml).toContain('w:ins')
    expect(xml).toContain('STYLEREF')
  })
})

describe('structural merge reconciliation', () => {
  it('merges a table over a disjoint text edit', async () => {
    const base = await parseFixture()
    const anchor = mainParagraphs(base)[0]
    const otherRun = mainParagraphs(base)[1]?.runs[0]
    if (!anchor || !otherRun) throw new Error('Fixture model is missing.')
    const current = await editedSource([
      { type: 'replace_run_text', runId: otherRun.id, text: 'Other revision' },
    ])
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'insert_table',
            paragraphId: anchor.id,
            rows: 1,
            columns: 1,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('refuses a table whose anchor was deleted in the current version', async () => {
    const base = await parseFixture()
    const anchor = mainParagraphs(base)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    const current = await editedSource([
      { type: 'delete_paragraph', paragraphId: anchor.id },
    ])
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'insert_table',
            paragraphId: anchor.id,
            rows: 1,
            columns: 1,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('refuses an image whose anchor text moved in the current version', async () => {
    const base = await parseFixture()
    const anchor = mainParagraphs(base)[0]
    const anchorRun = anchor?.runs[0]
    if (!anchor || !anchorRun) throw new Error('Fixture model is missing.')
    const current = await editedSource([
      { type: 'replace_run_text', runId: anchorRun.id, text: 'Moved text' },
    ])
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'insert_image',
            paragraphId: anchor.id,
            offset: 0,
            contentType: 'image/png',
            dataBase64: PNG_BASE64,
            widthPx: 10,
            heightPx: 10,
            name: 'Figure',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })
})

async function editedSource(operations: readonly DocumentEditOperation[]) {
  const document = await parseFixture()
  applyDocumentEdits(document, operations)
  return parseDocx(await serialiseDocx(document))
}

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
