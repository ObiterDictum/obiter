import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { contentFrame, layoutDocument } from './document-page-engine'
import { wrapLines } from './document-page-flow'
import { documentPageBox } from './document-page-layout'
import { marginBandHeights } from './document-page-margin'
import { paragraphFace, paragraphLineHeightPx } from './document-page-style'

const SHORT_PAGE =
  '<w:sectPr><w:pgSz w:w="11906" w:h="4000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>'
const NO_WIDOW = '<w:pPr><w:widowControl w:val="0"/></w:pPr>'

function breakParagraph(id: string, breaks: number): DocumentParagraphWire {
  return {
    id,
    runs: [
      {
        id: `${id}-r`,
        text: 'line\n'.repeat(breaks),
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: [NO_WIDOW],
  }
}

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

describe('layoutDocument trailing-row pagination', () => {
  it('draws the browser row list across a page split, with no row lost or repeated', () => {
    const text = 'line\n'.repeat(30)
    const model = modelOf([breakParagraph('p1', 30)], SHORT_PAGE)
    const pages = layoutDocument(model)
    expect(pages.length).toBeGreaterThan(1)
    const drawn = pages
      .flatMap((page) => page.blocks)
      .flatMap((block) => {
        if (block.type !== 'paragraph') return []
        const from = block.from ?? 0
        return wrapLines(
          text.slice(from, block.to),
          16,
          block.wrapWidthPx ?? 1,
        ).map((line) => ({ from: from + line.from, to: from + line.to }))
      })
    // `String.split` is the browser row list for a textarea: one row per
    // segment plus the empty row a trailing break opens.
    expect(drawn.length).toBe(text.split('\n').length)
    const covered = Array.from({ length: text.length }, () => 0)
    for (const row of drawn) {
      for (let index = row.from; index < row.to; index += 1) {
        covered[index] = (covered[index] ?? 0) + 1
      }
    }
    for (let index = 0; index < text.length; index += 1) {
      expect(covered[index]).toBe(text[index] === '\n' ? 0 : 1)
    }
  })

  it('reserves the trailing empty row when deciding whether the next paragraph fits', () => {
    const linePx = paragraphLineHeightPx(
      paragraphFace(breakParagraph('p1', 0), []),
    )
    // A page ten and a half default lines tall: ten body rows fit after the
    // trailing empty row, an eleventh does not.
    const pageTwips = Math.round(1440 + 15 * 10.5 * linePx)
    const sectPr = `<w:sectPr><w:pgSz w:w="11906" w:h="${pageTwips}"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>`
    const model = modelOf(
      [breakParagraph('p1', 9), paragraph('tail', 'Tail')],
      sectPr,
    )
    const frame = contentFrame(documentPageBox(model), marginBandHeights(model))
    expect(Math.floor(frame.heightPx / linePx)).toBe(10)
    const pages = layoutDocument(model)
    const pageOfTail = pages.findIndex((page) =>
      page.blocks.some(
        (block) => block.type === 'paragraph' && block.paragraph.id === 'tail',
      ),
    )
    // Nine breaks and the empty row the last one opens fill ten lines, leaving
    // half a line: the tail paragraph cannot share it. A model without the
    // trailing row thinks a line and a half remain and keeps the tail here.
    expect(pageOfTail).toBe(1)
  })
})
