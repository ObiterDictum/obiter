import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'
import { marginStories } from './document-page-layout'
import { tableHeight } from './document-page-blocks'

const SHORT_PAGE =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>'
function paragraph(
  id: string,
  text: string,
  xml: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: xml }],
    preservedXmlFragments: [],
  }
}
function modelOf(
  paragraphs: DocumentParagraphWire[],
  section = SHORT_PAGE,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [section],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}
function withNote(paragraphs: DocumentParagraphWire[], text: string) {
  const model = modelOf(paragraphs)
  model.stories.push({
    partName: 'word/footnotes.xml',
    kind: 'footnotes',
    paragraphs: [paragraph('note', text)],
    preservedXmlFragments: ['<w:footnote w:id="1"><w:p/></w:footnote>'],
    fields: [],
    unanchoredFieldParagraphIds: [],
  })
  return model
}
const reference = () =>
  paragraph('ref', 'Claim', ['<w:footnoteReference w:id="1"/>'])

describe('page layout regressions', () => {
  it('includes cell minimum height, vertical padding and collapsed borders when splitting tables', () => {
    expect(
      tableHeight(
        {
          bordered: true,
          paragraphIds: ['cell'],
          rows: [
            {
              heightPx: 48,
              cells: [{ span: 1, minHeightPx: 48, paragraphIds: ['cell'] }],
            },
          ],
        },
        modelOf([paragraph('cell', 'Cell')]),
        undefined,
        {},
        200,
      ),
    ).toBe(53)
  })

  it('splits tall tables between rows without losing rows or overlapping following text', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      heightPx: 48,
      cells: [{ span: 1, paragraphIds: [`row${i}`] }],
    }))
    const paragraphs = rows.map((row) =>
      paragraph(row.cells[0]?.paragraphIds[0] ?? '', 'Cell'),
    )
    const pages = layoutDocument(
      modelOf([...paragraphs, paragraph('after', 'After')]),
      undefined,
      [],
      {},
      [
        {
          type: 'table',
          table: {
            bordered: true,
            rows,
            paragraphIds: paragraphs.map((p) => p.id),
          },
        },
        { type: 'paragraph', paragraph: paragraph('after', 'After') },
      ],
    )
    expect(pages.length).toBeGreaterThan(1)
    expect(
      pages.flatMap((page) =>
        page.blocks.flatMap((block) =>
          block.type === 'table' ? block.table.rows : [],
        ),
      ),
    ).toEqual(rows)
    for (const page of pages)
      expect(
        page.blocks.reduce(
          (sum, block) =>
            sum + (block.type === 'table' ? block.table.rows.length * 48 : 19),
          0,
        ),
      ).toBeLessThanOrEqual(page.frame.heightPx)
  })

  it('keeps a footnote beneath its reference and reduces that page body height', () => {
    const model = withNote(
      [
        reference(),
        ...Array.from({ length: 40 }, (_, i) => paragraph(`body${i}`, 'Body')),
      ],
      'Footnote text',
    )
    const pages = layoutDocument(model)
    expect(
      pages[0]?.footnotes?.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'note',
      ),
    ).toBe(true)
    expect(pages[0]?.frame.heightPx).toBeLessThan(
      layoutDocument(modelOf(model.stories[0]?.paragraphs ?? []))[0]?.frame
        .heightPx ?? 0,
    )
    expect(
      pages
        .slice(1)
        .some((page) =>
          page.blocks.some(
            (block) =>
              block.type === 'paragraph' && block.paragraph.id === 'note',
          ),
        ),
    ).toBe(false)
  })

  it('selects each section header and footer rather than the final section stories', () => {
    const first = paragraph('first', 'First')
    first.preservedXmlFragments = [
      '<w:sectPr><w:headerReference w:type="default" r:id="h1"/><w:footerReference w:type="default" r:id="f1"/></w:sectPr>',
    ]
    const model = modelOf(
      [first, paragraph('second', 'Second')],
      '<w:sectPr><w:headerReference w:type="default" r:id="h2"/><w:footerReference w:type="default" r:id="f2"/></w:sectPr>',
    )
    for (const kind of ['header', 'footer'] as const)
      for (const n of [1, 2]) {
        const id = `${kind[0]}${n}`
        model.stories.push({
          partName: `word/${kind}${n}.xml`,
          kind,
          paragraphs: [paragraph(id, id)],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        })
        model.relationships.push({
          sourcePartName: 'word/document.xml',
          id,
          type: kind,
          sourceFragment: '',
          target: `${kind}${n}.xml`,
        })
      }
    const pages = layoutDocument(model)
    expect(pages).toHaveLength(2)
    for (const [index, page] of pages.entries()) {
      expect(page.sectionIndex).toBe(index)
      expect(
        marginStories(model, 'header', page.sectionIndex)[0]?.partName,
      ).toBe(`word/header${index + 1}.xml`)
      expect(
        marginStories(model, 'footer', page.sectionIndex)[0]?.partName,
      ).toBe(`word/footer${index + 1}.xml`)
    }
  })

  it('continues long footnotes onto later pages without losing text', () => {
    const text = 'note '.repeat(800)
    const pages = layoutDocument(
      withNote([reference(), paragraph('after', 'After')], text),
    )
    const fragments = pages
      .flatMap((page) => page.footnotes?.blocks ?? [])
      .flatMap((block) =>
        block.type === 'paragraph' ? [text.slice(block.from, block.to)] : [],
      )
    expect(fragments.join('')).toBe(text)
    expect(pages.filter((page) => page.footnotes).length).toBeGreaterThan(1)
    expect(pages.every((page) => page.frame.heightPx > 0)).toBe(true)
  })

  it('keeps a late-page reference with its footnote when reservation pushes it forward', () => {
    const pages = layoutDocument(
      withNote(
        [
          ...Array.from({ length: 9 }, (_, i) => paragraph(`lead${i}`, 'Lead')),
          reference(),
          paragraph('after', 'After'),
        ],
        'Note\nSecond\nThird',
      ),
    )
    const index = pages.findIndex((page) =>
      page.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'ref',
      ),
    )
    expect(pages[index]?.footnotes?.blocks.length).toBeGreaterThan(0)
    expect(pages.slice(0, index).every((page) => !page.footnotes)).toBe(true)
  })

  it('repeats table header rows on continuation pages and isolates an oversized row', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      heightPx: i === 7 ? 300 : 48,
      header: i === 0,
      cells: [{ span: 1, paragraphIds: [`row${i}`] }],
    }))
    const model = modelOf(rows.map((row, i) => paragraph(`row${i}`, 'Cell')))
    const pages = layoutDocument(model, undefined, [], {}, [
      {
        type: 'table',
        table: {
          bordered: true,
          rows,
          paragraphIds: rows.flatMap((row) =>
            row.cells.flatMap((cell) => cell.paragraphIds),
          ),
        },
      },
    ])
    const tables = pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.type === 'table' ? [block.table] : [],
      ),
    )
    expect(
      tables.filter((table) => table.rows[0]?.header).length,
    ).toBeGreaterThan(1)
    expect(
      tables.find((table) => table.rows.some((row) => row.heightPx === 300))
        ?.rows,
    ).toHaveLength(1)
    expect(
      tables.flatMap((table) => table.rows.filter((row) => !row.header)),
    ).toEqual(rows.slice(1))
  })
})
