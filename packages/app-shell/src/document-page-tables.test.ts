// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  cellWrapWidthPx,
  storyBlocks,
  storyTables,
  tablePaintHeight,
} from './document-page-tables'

const tableXml = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:shd w:fill="1F4E79"/><w:gridSpan w:val="1"/></w:tcPr><w:p w14:paraId="AABBCCDD"><w:r><w:t>Particulars</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="EEFF0011"><w:r><w:t>Details</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`

describe('storyTables', () => {
  it('reads cell fill, spans and paragraph ids', () => {
    const tables = storyTables({
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [],
      preservedXmlFragments: [tableXml],
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
              },
              { span: 1, paragraphIds: ['para-w14-EEFF0011'] },
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
    })
    expect(tables[0]?.rows[0]?.cells.map((cell) => cell.fill)).toEqual([
      '#A6A6A6',
      '#7F7F7F',
    ])
    expect(tables[0]?.rows[0]?.cells[0]?.paragraphIds).toEqual([
      'para-w14-AABBCCDD',
    ])
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
})
