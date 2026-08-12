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
})
