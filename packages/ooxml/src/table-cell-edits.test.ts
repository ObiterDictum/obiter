import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { parseXmlElements } from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { transformTableXml } from './table-structure-edits'

async function parseFixture(name: Parameters<typeof buildOoxmlFixture>[0]) {
  return parseDocx(await buildOoxmlFixture(name))
}

async function zipText(bytes: Uint8Array, path: string) {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(path)
  if (!file) throw new Error(`Missing ${path}`)
  return file.async('string')
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}

describe('rich table cell edits', () => {
  it('emits run and paragraph properties for insert_table cellEdits and reparses them', async () => {
    const document = await parseFixture('full-fidelity-with-w14-ids')
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_table',
        paragraphId: anchor.id,
        rows: 1,
        columns: 2,
        cellEdits: [
          { row: 0, column: 0, text: 'Plain' },
          {
            row: 0,
            column: 1,
            runs: [
              { text: 'Bold', bold: true, fontFamily: 'Arial', fontSize: 24 },
            ],
            paragraph: {
              alignment: 'center',
              indentation: { left: 720 },
              lineSpacing: { line: 360, lineRule: 'auto' },
              numbering: { numId: '1', ilvl: 0 },
            },
          },
        ],
      },
    ])

    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:jc w:val="center"/>')
    expect(xml).toContain('<w:ind ')
    expect(xml).toContain('<w:spacing ')
    expect(xml).toContain('<w:numPr>')
    expect(xml).toContain('<w:numId w:val="1"/>')

    const reparsed = await parseDocx(output)
    const cell = mainParagraphs(reparsed).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Bold'),
    )
    if (!cell) throw new Error('Edited cell paragraph is missing.')
    const fragments = cell.preservedXmlFragments.join('')
    expect(fragments).toContain('<w:jc w:val="center"/>')
    expect(fragments).toContain('<w:ind ')
    expect(fragments).toContain('<w:spacing ')
    expect(fragments).toContain('<w:numPr>')
    const boldRun = cell.runs.find((run) => run.text === 'Bold')
    expect(boldRun?.preservedXmlFragments.join('')).toContain('<w:b/>')
  })

  it('keeps text-only cellEdits working without run or paragraph payloads', async () => {
    const document = await parseFixture('full-fidelity-with-w14-ids')
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_table',
        paragraphId: anchor.id,
        rows: 1,
        columns: 1,
        cellEdits: [{ row: 0, column: 0, text: 'Legacy' }],
      },
    ])

    const reparsed = await parseDocx(await serialiseDocx(document))
    const cell = mainParagraphs(reparsed).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Legacy'),
    )
    if (!cell) throw new Error('Edited cell paragraph is missing.')
    expect(cell.preservedXmlFragments.join('')).not.toContain('<w:numPr>')
  })

  it('emits cellEdits content through table structure transforms', () => {
    const source =
      '<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body>'
    const elements = parseXmlElements(source)
    const table = elements.find((e) => isWord(e, 'tbl'))
    const row = elements.find((e) => isWord(e, 'tr'))
    const cell = elements.find((e) => isWord(e, 'tc'))
    if (!table || !row || !cell) throw new Error('Missing fixture')

    const xml = transformTableXml(
      source,
      elements,
      table,
      row,
      cell,
      {
        type: 'insert_table_row',
        paragraphId: 'p',
        position: 'after',
        cellEdits: [
          {
            row: 0,
            column: 0,
            runs: [{ text: 'RowCell', italic: true }],
            paragraph: { alignment: 'right' },
          },
        ],
      },
      () => '00000001',
    ).xml

    expect(xml).toContain('RowCell')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('<w:jc w:val="right"/>')
  })
})
