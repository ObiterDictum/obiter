import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'

const A4_LETTER =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2325" w:right="1797" w:bottom="2041" w:left="1797" w:header="708" w:footer="708"/></w:sectPr>'

function paragraph(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
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
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

const WEB = { kind: 'web' as const, widthPx: 500 }

describe('layoutDocument web flow', () => {
  it('fills one margin-free column at the given width', () => {
    const model = modelOf(
      Array.from({ length: 40 }, (_, index) =>
        paragraph(`p${index + 1}`, `Body line ${index + 1}.`),
      ),
      A4_LETTER,
    )
    const pages = layoutDocument(model, undefined, [], {}, undefined, [], WEB)
    expect(pages).toHaveLength(1)
    const page = pages[0]
    expect(page?.box.widthPx).toBe(500)
    expect(page?.box.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(page?.columns).toEqual([{ left: 0, widthPx: 500 }])
    expect(page?.blocks).toHaveLength(40)
    // The flow records the height its content filled, not the frame bound.
    expect(page?.contentPx).toBeGreaterThan(0)
    expect(page?.contentPx).toBeLessThan(10_000)
  })

  it('paginates print geometry the web flow drops', () => {
    const model = modelOf(
      Array.from({ length: 200 }, (_, index) =>
        paragraph(`p${index + 1}`, `Body line ${index + 1}.`),
      ),
      A4_LETTER,
    )
    const printed = layoutDocument(model)
    const flowed = layoutDocument(model, undefined, [], {}, undefined, [], WEB)
    expect(printed.length).toBeGreaterThan(1)
    expect(flowed).toHaveLength(1)
  })

  it('still honours a stored page break inside the flow', () => {
    const stored = modelOf([
      paragraph('p1', 'Before the break.'),
      {
        ...paragraph('p2', 'After the break.'),
        preservedXmlFragments: ['<w:pPr><w:pageBreakBefore/></w:pPr>'],
      },
    ])
    const pages = layoutDocument(stored, undefined, [], {}, undefined, [], WEB)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.contentPx).toBeGreaterThan(0)
  })
})
