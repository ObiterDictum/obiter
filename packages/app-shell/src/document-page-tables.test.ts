import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import {
  cellWrapWidthPx,
  storyBlocks,
  storyTables,
  tableCellNeighbours,
  tablePaintHeight,
  tablePaintRows,
} from './document-page-tables'

const tableXml = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:shd w:fill="1F4E79"/><w:gridSpan w:val="1"/></w:tcPr><w:p w14:paraId="AABBCCDD"><w:r><w:t>Particulars</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="EEFF0011"><w:r><w:t>Details</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`

describe('storyTables', () => {
  it('preserves enabled repeating headers when table paragraphs need rebinding', () => {
    const story = {
      partName: 'word/document.xml',
      kind: 'document' as const,
      paragraphs: [
        {
          id: 'rebound',
          runs: [{ id: 'r', text: 'Heading', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [
        '<w:tbl><w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="720"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>',
      ],
      fields: [],
      unanchoredFieldParagraphIds: [],
    }
    const block = storyBlocks(story)[0]
    expect(block?.type).toBe('table')
    if (block?.type !== 'table') throw new Error('Expected table')
    expect(block.table.rows[0]?.header).toBe(true)
    expect(block.table.rows[0]?.heightPx).toBe(48)
    expect(block.table.paragraphIds).toEqual(['rebound'])
  })
  it('reads cell fill, spans and paragraph ids', () => {
    const tables = storyTables({
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [],
      preservedXmlFragments: [tableXml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(tables).toEqual([
      {
        bordered: true,
        paragraphIds: ['para-w14-AABBCCDD', 'para-w14-EEFF0011'],
        rows: [
          {
            cells: [
              {
                fill: '#1F4E79',
                span: 1,
                paragraphIds: ['para-w14-AABBCCDD'],
                paragraphCount: 1,
              },
              {
                span: 1,
                paragraphIds: ['para-w14-EEFF0011'],
                paragraphCount: 1,
              },
            ],
          },
        ],
      },
    ])
  })
})

describe('storyBlocks', () => {
  it('places table cell paragraphs inside the table instead of flattening them', () => {
    const blocks = storyBlocks({
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'para-w14-AABBCCDD',
          runs: [{ id: 'r1', text: 'Particulars', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        {
          id: 'para-w14-EEFF0011',
          runs: [{ id: 'r2', text: 'Details', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [tableXml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(blocks.map((block) => block.type)).toEqual(['table'])
  })

  it('nests an unmatched header logo into the centre cell of a three-cell bar', () => {
    const xml = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="LEFT0001"/></w:tc><w:tc><w:p w14:paraId="MID00002"><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="RIGHT001"/></w:tc></w:tr></w:tbl>`
    const drawing =
      '<w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const blocks = storyBlocks({
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'para-header-logo',
          runs: [{ id: 'r1', text: '', preservedXmlFragments: [drawing] }],
          preservedXmlFragments: [],
        },
        {
          id: 'para-header-note',
          runs: [{ id: 'r2', text: 'Confidential', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [xml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(blocks.map((block) => block.type)).toEqual(['table', 'paragraph'])
    const table = blocks[0]
    if (table?.type !== 'table') throw new Error('expected table')
    expect(table.table.rows[0]?.cells.map((cell) => cell.fill)).toEqual([
      '#A6A6A6',
      undefined,
      '#A6A6A6',
    ])
    expect(table.table.rows[0]?.cells.map((cell) => cell.paragraphIds)).toEqual(
      [[], ['para-header-logo'], []],
    )
  })

  it('still centres a header logo when empty side-cell para ids exist in the story', () => {
    const xml = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="LEFT0001"/></w:tc><w:tc><w:p w14:paraId="MID00002"/></w:tc><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="RIGHT001"/></w:tc></w:tr></w:tbl>`
    const drawing =
      '<w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const blocks = storyBlocks({
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'para-w14-LEFT0001',
          runs: [{ id: 'r0', text: '', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        {
          id: 'para-header-logo',
          runs: [{ id: 'r1', text: '', preservedXmlFragments: [drawing] }],
          preservedXmlFragments: [],
        },
        {
          id: 'para-w14-RIGHT001',
          runs: [{ id: 'r2', text: '', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [xml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    const table = blocks[0]
    if (table?.type !== 'table') throw new Error('expected table')
    expect(table.table.rows[0]?.cells.map((cell) => cell.fill)).toEqual([
      '#A6A6A6',
      undefined,
      '#A6A6A6',
    ])
    expect(table.table.rows[0]?.cells.map((cell) => cell.paragraphIds)).toEqual(
      [[], ['para-header-logo'], []],
    )
  })

  it('puts unmatched footer text into table cells and uses a leftover shape as fill', () => {
    const xml = `<w:tbl><w:tr><w:tc><w:p w14:paraId="AAAA0001"/></w:tc><w:tc><w:p w14:paraId="BBBB0002"/></w:tc><w:tc><w:p w14:paraId="CCCC0003"/></w:tc></w:tr></w:tbl>`
    const shape =
      '<w:drawing><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></w:drawing>'
    const blocks = storyBlocks({
      partName: 'word/footer1.xml',
      kind: 'footer',
      paragraphs: [
        {
          id: 'shape',
          runs: [{ id: 's1', text: '', preservedXmlFragments: [shape] }],
          preservedXmlFragments: [],
        },
        {
          id: 'left',
          runs: [{ id: 't1', text: '+44111', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        {
          id: 'mid',
          runs: [{ id: 't2', text: '1', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        {
          id: 'right',
          runs: [
            { id: 't3', text: 'www.example.com', preservedXmlFragments: [] },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [xml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(blocks.map((block) => block.type)).toEqual(['table'])
    const table = blocks[0]
    if (table?.type !== 'table') throw new Error('expected table')
    expect(table.table.rows[0]?.cells.map((cell) => cell.paragraphIds)).toEqual(
      [['left'], ['mid'], ['right']],
    )
    expect(
      table.table.rows[0]?.cells.every((cell) => cell.fill === '#3A3A3A'),
    ).toBe(true)
  })

  it('paints empty header side cells when the greys are shapes not cell shade', () => {
    const xml = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p w14:paraId="LEFT0001"/></w:tc><w:tc><w:p w14:paraId="MID00002"/></w:tc><w:tc><w:p w14:paraId="RIGHT001"/></w:tc></w:tr></w:tbl>`
    const drawing =
      '<w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const shape =
      '<w:drawing><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></w:drawing>'
    const blocks = storyBlocks({
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'para-header-logo',
          runs: [{ id: 'r1', text: '', preservedXmlFragments: [drawing] }],
          preservedXmlFragments: [],
        },
        {
          id: 'shape',
          runs: [{ id: 's1', text: '', preservedXmlFragments: [shape] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [xml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    const table = blocks[0]
    if (table?.type !== 'table') throw new Error('expected table')
    expect(table.table.rows[0]?.cells.map((cell) => cell.fill)).toEqual([
      '#A6A6A6',
      undefined,
      '#A6A6A6',
    ])
    expect(table.table.rows[0]?.cells.map((cell) => cell.paragraphIds)).toEqual(
      [[], ['para-header-logo'], []],
    )
  })
})

describe('storyTables with drawings', () => {
  it('still reads cell fill when a drawing uses unbound prefixes', () => {
    const xml = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="AABBCCDD"><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="7F7F7F"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`
    const tables = storyTables({
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [],
      preservedXmlFragments: [xml],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(tables[0]?.rows[0]?.cells.map((cell) => cell.fill)).toEqual([
      '#A6A6A6',
      '#7F7F7F',
    ])
    expect(tables[0]?.rows[0]?.cells[0]?.paragraphIds).toEqual([
      'para-w14-AABBCCDD',
    ])
  })

  it('refuses a table fragment that declares a DTD or entity', () => {
    const attacks = [
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>',
      '<w:tbl><!ENTITY lol "lol"><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>',
    ]
    for (const xml of attacks) {
      const start = performance.now()
      const tables = storyTables({
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [],
        preservedXmlFragments: [xml],
        fields: [],
        unanchoredFieldParagraphIds: [],
      })
      expect(performance.now() - start).toBeLessThan(1000)
      expect(tables).toEqual([])
    }
  })
})

describe('tablePaintHeight', () => {
  it('counts a filled row at the painted min-height, not the 28px fallback', () => {
    expect(
      tablePaintHeight({
        bordered: false,
        paragraphIds: ['a'],
        rows: [
          {
            cells: [{ span: 1, fill: '#1F4E79', paragraphIds: ['a'] }],
          },
          {
            cells: [{ span: 1, paragraphIds: ['b'] }],
          },
        ],
      }),
    ).toBe(76)
  })
})

describe('cellWrapWidthPx', () => {
  it('uses the cell width percentage minus horizontal padding', () => {
    expect(
      cellWrapWidthPx({ span: 1, paragraphIds: [], widthPct: 50 }, 400),
    ).toBe(192)
    expect(cellWrapWidthPx({ span: 1, paragraphIds: [] }, 400, 2)).toBe(192)
  })

  it('floors the wrap width at 1 so narrow cells still wrap per character', () => {
    expect(
      cellWrapWidthPx({ span: 1, paragraphIds: [], widthPct: 1 }, 400),
    ).toBe(1)
    expect(
      cellWrapWidthPx({ span: 1, paragraphIds: [], widthPct: 0.5 }, 100),
    ).toBe(1)
  })

  it('does not subtract horizontal padding for filled cells, which paint with p-0', () => {
    expect(
      cellWrapWidthPx(
        { span: 1, paragraphIds: [], widthPct: 50, fill: '#1F4E79' },
        400,
      ),
    ).toBe(200)
    expect(
      cellWrapWidthPx({ span: 1, paragraphIds: [], fill: '#A6A6A6' }, 400, 2),
    ).toBe(200)
  })
})

describe('tables without Word paragraph ids', () => {
  const cell = (text: string) =>
    `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
  const plain = (id: string, text: string) => ({
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  })

  it('binds the cells to the paragraphs that hold their text, not to the first paragraphs of the story', () => {
    const blocks = storyBlocks({
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        plain('p1', 'Skeleton argument'),
        plain('p2', 'Background'),
        plain('p3', 'R1C1'),
        plain('p4', 'R1C2'),
        plain('p5', 'R2C1'),
        plain('p6', 'R2C2'),
        plain('p7', 'Submissions'),
      ],
      preservedXmlFragments: [
        `<w:tbl><w:tr>${cell('R1C1')}${cell('R1C2')}</w:tr><w:tr>${cell('R2C1')}${cell('R2C2')}</w:tr></w:tbl>`,
      ],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(
      blocks.map((block) =>
        block.type === 'table' ? block.table.paragraphIds : block.paragraph.id,
      ),
    ).toEqual(['p1', 'p2', ['p3', 'p4', 'p5', 'p6'], 'p7'])
  })

  it('binds two tables with the same cell text in story order', () => {
    const table = `<w:tbl><w:tr>${cell('Yes')}${cell('No')}</w:tr></w:tbl>`
    const blocks = storyBlocks({
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        plain('a', 'First question'),
        plain('b', 'Yes'),
        plain('c', 'No'),
        plain('d', 'Second question'),
        plain('e', 'Yes'),
        plain('f', 'No'),
      ],
      preservedXmlFragments: [table, table],
      fields: [],
      unanchoredFieldParagraphIds: [],
    })
    expect(
      blocks.map((block) =>
        block.type === 'table' ? block.table.paragraphIds : block.paragraph.id,
      ),
    ).toEqual(['a', ['b', 'c'], 'd', ['e', 'f']])
  })
})

describe('tableCellNeighbours', () => {
  it('steps through cells row by row, landing on the first paragraph of each cell', () => {
    const cell = (...ids: string[]) =>
      `<w:tc>${ids.map((id) => `<w:p w14:paraId="${id}"><w:r><w:t>${id}</w:t></w:r></w:p>`).join('')}</w:tc>`
    const story = {
      partName: 'word/document.xml',
      kind: 'document' as const,
      paragraphs: [
        '0000000A',
        '0000000B',
        '0000000C',
        '0000000D',
        '0000000E',
      ].map((id) => ({
        id: `para-w14-${id}`,
        runs: [{ id: `r-${id}`, text: id, preservedXmlFragments: [] }],
        preservedXmlFragments: [],
      })),
      preservedXmlFragments: [
        `<w:tbl><w:tr>${cell('0000000A', '0000000B')}${cell('0000000C')}</w:tr><w:tr>${cell('0000000D')}${cell('0000000E')}</w:tr></w:tbl>`,
      ],
      fields: [],
      unanchoredFieldParagraphIds: [],
    }
    const neighbours = tableCellNeighbours(story)
    expect(neighbours.get('para-w14-0000000A')).toEqual({
      next: 'para-w14-0000000C',
    })
    expect(neighbours.get('para-w14-0000000B')).toEqual({
      next: 'para-w14-0000000C',
    })
    expect(neighbours.get('para-w14-0000000C')).toEqual({
      previous: 'para-w14-0000000A',
      next: 'para-w14-0000000D',
    })
    expect(neighbours.get('para-w14-0000000E')).toEqual({
      previous: 'para-w14-0000000D',
    })
  })
})

const tc = (paraId: string, text: string, props = '') =>
  `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}<w:p w14:paraId="${paraId}">${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p></w:tc>`
const tr = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`
const tbl = (...rows: string[]) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows.join('')}</w:tbl>`
const tableStory = (xml: string) => ({
  partName: 'word/document.xml',
  kind: 'document' as const,
  paragraphs: [],
  preservedXmlFragments: [xml],
  fields: [],
  unanchoredFieldParagraphIds: [],
})

describe('vertical merges', () => {
  it('reads a two-row vertical merge as one cell spanning both rows', () => {
    const tables = storyTables(
      tableStory(
        tbl(
          tr(
            tc('M0000001', 'Merged', '<w:vMerge w:val="restart"/>'),
            tc('B0000002', 'B1'),
            tc('C0000003', 'C1'),
          ),
          tr(
            tc('M0000004', '', '<w:vMerge/>'),
            tc('B0000005', 'B2'),
            tc('C0000006', 'C2'),
          ),
          tr(tc('A0000007', 'A3'), tc('B0000008', 'B3'), tc('C0000009', 'C3')),
        ),
      ),
    )
    const rows = tables[0]?.rows ?? []
    expect(rows[0]?.cells[0]).toMatchObject({
      span: 1,
      rowSpan: 2,
      vMerge: 'restart',
    })
    expect(rows[1]?.cells[0]).toMatchObject({ vMerge: 'continue' })
    expect(rows[1]?.cells[0]?.rowSpan).toBeUndefined()
    expect(rows[1]?.cells[0]?.paragraphIds).toEqual(['para-w14-M0000004'])
    expect(rows[2]?.cells[0]?.vMerge).toBeUndefined()
    expect(rows[2]?.cells[0]?.rowSpan).toBeUndefined()
  })

  it('spans a merge across three rows', () => {
    const tables = storyTables(
      tableStory(
        tbl(
          tr(
            tc('M0000001', 'Merged', '<w:vMerge w:val="restart"/>'),
            tc('B0000002', 'B1'),
          ),
          tr(tc('M0000003', '', '<w:vMerge/>'), tc('B0000004', 'B2')),
          tr(tc('M0000005', '', '<w:vMerge/>'), tc('B0000006', 'B3')),
          tr(tc('A0000007', 'A4'), tc('B0000008', 'B4')),
        ),
      ),
    )
    const rows = tables[0]?.rows ?? []
    expect(rows[0]?.cells[0]?.rowSpan).toBe(3)
    expect(rows[1]?.cells[0]?.vMerge).toBe('continue')
    expect(rows[2]?.cells[0]?.vMerge).toBe('continue')
    expect(rows[3]?.cells[0]?.vMerge).toBeUndefined()
  })

  it('combines a vertical merge with a horizontal grid span', () => {
    const tables = storyTables(
      tableStory(
        tbl(
          tr(
            tc(
              'M0000001',
              'Merged',
              '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>',
            ),
            tc('C0000003', 'C1'),
          ),
          tr(
            tc('M0000004', '', '<w:gridSpan w:val="2"/><w:vMerge/>'),
            tc('C0000006', 'C2'),
          ),
        ),
      ),
    )
    const rows = tables[0]?.rows ?? []
    expect(rows[0]?.cells[0]).toMatchObject({
      span: 2,
      rowSpan: 2,
      vMerge: 'restart',
    })
    expect(rows[1]?.cells[0]).toMatchObject({
      span: 2,
      vMerge: 'continue',
    })
  })

  it('paints continuation cells nothing and skips their paragraphs', () => {
    const table = storyTables(
      tableStory(
        tbl(
          tr(
            tc('M0000001', 'Merged', '<w:vMerge w:val="restart"/>'),
            tc('B0000002', 'B1'),
            tc('C0000003', 'C1'),
          ),
          tr(
            tc('M0000004', '', '<w:vMerge/>'),
            tc('B0000005', 'B2'),
            tc('C0000006', 'C2'),
          ),
          tr(tc('A0000007', 'A3'), tc('B0000008', 'B3'), tc('C0000009', 'C3')),
        ),
      ),
    )[0]
    if (!table) throw new Error('expected table')
    const painted = tablePaintRows(table)
    expect(
      painted.map((row) =>
        row.cells.map(({ cell, rowSpan }) => ({
          span: cell.span,
          rowSpan,
          vMerge: cell.vMerge,
        })),
      ),
    ).toEqual([
      [
        { span: 1, rowSpan: 2, vMerge: 'restart' },
        { span: 1, rowSpan: 1, vMerge: undefined },
        { span: 1, rowSpan: 1, vMerge: undefined },
      ],
      [
        { span: 1, rowSpan: 1, vMerge: undefined },
        { span: 1, rowSpan: 1, vMerge: undefined },
      ],
      [
        { span: 1, rowSpan: 1, vMerge: undefined },
        { span: 1, rowSpan: 1, vMerge: undefined },
        { span: 1, rowSpan: 1, vMerge: undefined },
      ],
    ])
  })

  it('paints a merge that starts on a previous page as a continuing cell', () => {
    const table = storyTables(
      tableStory(
        tbl(
          tr(
            tc(
              'M0000001',
              'Merged',
              '<w:shd w:fill="1F4E79"/><w:vMerge w:val="restart"/>',
            ),
            tc('B0000002', 'B1'),
          ),
          tr(tc('M0000003', '', '<w:vMerge/>'), tc('B0000004', 'B2')),
          tr(tc('M0000005', '', '<w:vMerge/>'), tc('B0000006', 'B3')),
          tr(tc('A0000007', 'A4'), tc('B0000008', 'B4')),
        ),
      ),
    )[0]
    if (!table) throw new Error('expected table')
    const fragment = { ...table, rows: table.rows.slice(1, 3) }
    const painted = tablePaintRows(fragment)
    expect(painted).toHaveLength(2)
    expect(painted[0]?.cells[0]).toMatchObject({
      rowSpan: 2,
      cell: { vMerge: 'continue', mergeFill: '#1F4E79' },
    })
    expect(painted[1]?.cells).toHaveLength(1)
    expect(painted[1]?.cells[0]?.cell.vMerge).toBeUndefined()
  })

  it('reads the cell vertical alignment for merged and plain cells', () => {
    const tables = storyTables(
      tableStory(
        tbl(
          tr(
            tc(
              'M0000001',
              'Merged',
              '<w:vMerge w:val="restart"/><w:vAlign w:val="bottom"/>',
            ),
            tc('B0000002', 'B1', '<w:vAlign w:val="top"/>'),
          ),
          tr(tc('M0000003', '', '<w:vMerge/>'), tc('B0000004', 'B2')),
        ),
      ),
    )
    const rows = tables[0]?.rows ?? []
    expect(rows[0]?.cells[0]?.vAlign).toBe('bottom')
    expect(rows[0]?.cells[1]?.vAlign).toBe('top')
    expect(rows[1]?.cells[0]?.mergeVAlign).toBe('bottom')
  })
})
