// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'

const SHORT_PAGE =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>'
const TWO_COLS =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/><w:cols w:num="2" w:space="720"/></w:sectPr>'
const A4_LETTER =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2325" w:right="1797" w:bottom="2041" w:left="1797" w:header="708" w:footer="708"/></w:sectPr>'

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
  sectPr?: string,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: sectPr ? [sectPr] : [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function modelWithParagraphs(
  count: number,
  text: string,
  sectPr?: string,
): DocumentModelWire {
  return modelOf(
    Array.from({ length: count }, (_, index) =>
      paragraph(`p${index + 1}`, text),
    ),
    sectPr,
  )
}

function anchor(wrap: string, extra = ''): string {
  return `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0"><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2857500" cy="2857500"/><wp:${wrap}/>${extra}<pic:pic><a:blip r:embed="rId1"/><a:ext cx="2857500" cy="2857500"/></pic:pic></wp:anchor></w:drawing>`
}

describe('layoutDocument', () => {
  it('keeps a short document on one page', () => {
    const pages = layoutDocument(modelWithParagraphs(3, 'Hello'))
    expect(pages).toHaveLength(1)
    expect(pages[0]?.blocks).toHaveLength(3)
    expect(pages[0]?.frame.left).toBe(96)
    expect(pages[0]?.columns).toHaveLength(1)
  })

  it('keeps an A4 letter of short body lines on one page', () => {
    const pages = layoutDocument(
      modelWithParagraphs(25, 'A short address line.', A4_LETTER),
    )
    expect(pages).toHaveLength(1)
    expect(pages[0]?.blocks).toHaveLength(25)
  })

  it('keeps the body below the painted letterhead, including Word header distance', () => {
    const group =
      '<w:drawing><wp:anchor><wp:positionV relativeFrom="paragraph"><wp:posOffset>-280035</wp:posOffset></wp:positionV></wp:anchor><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
    const base = modelWithParagraphs(3, 'A short address line.', A4_LETTER)
    const pages = layoutDocument({
      ...base,
      stories: [
        ...base.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [group] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    })
    const page = pages[0]
    expect(page?.frame.top).toBe(156)
    expect(page?.frame.top).toBeGreaterThan(page?.box.margin.top ?? 0)
  })

  it('paginates when body blocks exceed the content frame', () => {
    const pages = layoutDocument(
      modelWithParagraphs(
        80,
        'A short line of body text for pagination.',
        SHORT_PAGE,
      ),
    )
    expect(pages.length).toBeGreaterThan(1)
    const ids = pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.type === 'paragraph' ? [block.paragraph.id] : [],
      ),
    )
    expect(new Set(ids).size).toBe(80)
  })

  it('fills the next column before starting a new page', () => {
    const pages = layoutDocument(
      modelWithParagraphs(20, 'Column line.', TWO_COLS),
    )
    const columns = new Set(pages[0]?.blocks.map((block) => block.column ?? 0))
    expect(columns.has(0)).toBe(true)
    expect(columns.has(1)).toBe(true)
  })

  it('splits a long paragraph across pages', () => {
    const text = 'word '.repeat(400)
    const pages = layoutDocument(modelOf([paragraph('p1', text)], SHORT_PAGE))
    expect(pages.length).toBeGreaterThan(1)
    const slices = pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.type === 'paragraph' ? [block] : [],
      ),
    )
    expect(slices[0]?.from).toBe(0)
    expect(slices[0]?.continuation).toBe(false)
    expect(slices[1]?.continuation).toBe(true)
    expect(slices[slices.length - 1]?.to).toBe(text.length)
  })

  it('insets body text beside a square-wrapped float', () => {
    const host = paragraph('host', '', [anchor('wrapSquare')])
    const body = paragraph('body', 'word '.repeat(40))
    const pages = layoutDocument(modelOf([host, body]))
    const laid = pages[0]?.blocks.find(
      (block) => block.type === 'paragraph' && block.paragraph.id === 'body',
    )
    expect(
      laid && laid.type === 'paragraph' ? laid.padRightPx : 0,
    ).toBeGreaterThan(0)
    expect(pages[0]?.floats).toHaveLength(1)
  })

  it('does not inset body text beside wrapNone', () => {
    const host = paragraph('host', '', [anchor('wrapNone')])
    const body = paragraph('body', 'word '.repeat(40))
    const pages = layoutDocument(modelOf([host, body]))
    const laid = pages[0]?.blocks.find(
      (block) => block.type === 'paragraph' && block.paragraph.id === 'body',
    )
    expect(laid && laid.type === 'paragraph' ? laid.padRightPx : -1).toBe(0)
  })

  it('keeps text-box paragraphs out of the body flow', () => {
    const box = anchor(
      'wrapNone',
      '<w:txbxContent><w:p w14:paraId="ABCD"><w:r><w:t>Inside</w:t></w:r></w:p></w:txbxContent>',
    )
    const pages = layoutDocument(
      modelOf([
        paragraph('host', '', [box]),
        {
          id: 'para-w14-ABCD',
          sourceParaId: 'ABCD',
          runs: [{ id: 'in', text: 'Inside', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
        paragraph('after', 'After the box'),
      ]),
    )
    const ids = pages[0]?.blocks.flatMap((block) =>
      block.type === 'paragraph' ? [block.paragraph.id] : [],
    )
    expect(ids).toEqual(['after'])
    expect(pages[0]?.textBoxes[0]?.paragraphIds).toEqual(['para-w14-ABCD'])
  })

  it('does not treat Word last-rendered page breaks as hard breaks', () => {
    const pages = layoutDocument(
      modelOf([
        paragraph('p1', 'Hello'),
        {
          id: 'p2',
          runs: [
            {
              id: 'r2',
              text: 'Still this page',
              preservedXmlFragments: ['<w:lastRenderedPageBreak/>'],
            },
          ],
          preservedXmlFragments: [],
        },
      ]),
    )
    expect(pages).toHaveLength(1)
  })

  it('starts a new page at an explicit page break', () => {
    const pages = layoutDocument(
      modelOf([
        paragraph('p1', 'Hello'),
        {
          id: 'p2',
          runs: [
            {
              id: 'r2',
              text: 'Next page',
              preservedXmlFragments: ['<w:br w:type="page"/>'],
            },
          ],
          preservedXmlFragments: [],
        },
      ]),
    )
    expect(pages).toHaveLength(2)
    expect(
      pages[1]?.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'p2',
      ),
    ).toBe(true)
  })

  it('drops space-before at the top of a new page', () => {
    const pages = layoutDocument(
      modelOf([
        paragraph('p1', 'Hello'),
        {
          id: 'p2',
          runs: [
            {
              id: 'r2',
              text: 'Next page',
              preservedXmlFragments: ['<w:br w:type="page"/>'],
            },
          ],
          preservedXmlFragments: [
            '<w:pPr><w:spacing w:before="1440"/></w:pPr>',
          ],
        },
      ]),
    )
    const first = pages[1]?.blocks[0]
    expect(first?.type).toBe('paragraph')
    if (first?.type !== 'paragraph') return
    expect(first.paragraph.id).toBe('p2')
    expect(first.pageStart).toBe(true)
  })

  it('paginates empty inserted paragraphs onto a new page', () => {
    const inserts = Array.from({ length: 40 }, (_, index) => ({
      clientId: `ins${index + 1}`,
      afterParagraphId: index === 0 ? 'p1' : `ins${index}`,
      text: '',
    }))
    const pages = layoutDocument(
      modelWithParagraphs(1, 'Hello', SHORT_PAGE),
      {},
      inserts,
    )
    expect(pages.length).toBeGreaterThan(1)
    expect(
      pages.some((page) =>
        page.blocks.some(
          (block) =>
            block.type === 'paragraph' && block.paragraph.id === 'ins40',
        ),
      ),
    ).toBe(true)
  })

  it('treats newline characters as extra lines', () => {
    const pages = layoutDocument(
      modelOf(
        [paragraph('p1', `${'x'.repeat(8)}${'\n'.repeat(40)}`)],
        SHORT_PAGE,
      ),
    )
    expect(pages.length).toBeGreaterThan(1)
  })

  it('reserves height for an inline picture so following text can move to the next page', () => {
    const picture =
      '<w:drawing><wp:inline><wp:extent cx="2857500" cy="2857500"/><a:ext cx="2857500" cy="2857500"/><pic:pic><a:blip r:embed="rId1"/></pic:pic></wp:inline></w:drawing>'
    const pages = layoutDocument(
      modelOf(
        [paragraph('sig', '', [picture]), paragraph('name', 'Signed name')],
        SHORT_PAGE,
      ),
    )
    expect(pages.length).toBeGreaterThan(1)
    expect(
      pages[pages.length - 1]?.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'name',
      ),
    ).toBe(true)
  })

  it('moves a keep-next pair together when only one of them fits', () => {
    const filler = Array.from({ length: 9 }, (_, index) =>
      paragraph(`f${index}`, 'A short line.'),
    )
    const close = (keepNext: boolean): DocumentParagraphWire => ({
      id: 'close',
      runs: [
        {
          id: 'close-r',
          text: 'Yours faithfully,',
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: keepNext ? ['<w:pPr><w:keepNext/></w:pPr>'] : [],
    })
    const name = paragraph('name', 'Alex Example')
    const without = layoutDocument(
      modelOf([...filler, close(false), name], SHORT_PAGE),
    )
    const withKeep = layoutDocument(
      modelOf([...filler, close(true), name], SHORT_PAGE),
    )
    const pageOf = (pages: ReturnType<typeof layoutDocument>, id: string) =>
      pages.findIndex((page) =>
        page.blocks.some(
          (block) => block.type === 'paragraph' && block.paragraph.id === id,
        ),
      )
    expect(pageOf(without, 'name')).toBeGreaterThan(pageOf(without, 'close'))
    expect(pageOf(withKeep, 'close')).toBe(pageOf(withKeep, 'name'))
    expect(pageOf(withKeep, 'close')).toBeGreaterThan(0)
  })

  it('moves body text after a painted table onto the next page instead of the footer', () => {
    const cell = (id: string, text: string) =>
      `<w:tr><w:tc><w:tcPr><w:shd w:fill="1F4E79"/></w:tcPr><w:p w14:paraId="${id}"><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`
    const tableXml = `<w:tbl>${cell('ROW00001', 'A')}${cell('ROW00002', 'B')}${cell('ROW00003', 'C')}</w:tbl>`
    const base = modelOf(
      [
        paragraph('lead', 'Hi'),
        paragraph('para-w14-ROW00001', 'A'),
        paragraph('para-w14-ROW00002', 'B'),
        paragraph('para-w14-ROW00003', 'C'),
        paragraph('close', 'Sincerely,'),
      ],
      SHORT_PAGE,
    )
    const story = base.stories[0]
    if (!story) throw new Error('expected document story')
    const pages = layoutDocument({
      ...base,
      stories: [{ ...story, preservedXmlFragments: [tableXml, SHORT_PAGE] }],
    })
    expect(pages.length).toBeGreaterThan(1)
    expect(
      pages[0]?.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'close',
      ),
    ).toBe(false)
    expect(
      pages.some((page) =>
        page.blocks.some(
          (block) =>
            block.type === 'paragraph' && block.paragraph.id === 'close',
        ),
      ),
    ).toBe(true)
  })
})
