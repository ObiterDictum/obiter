import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'
import { textParagraph as paragraph } from './document-wire-test-support'

function storedBreakParagraph(
  id: string,
  before: string,
  after: string,
): DocumentParagraphWire {
  return {
    id,
    runs: [
      { id: `${id}-a`, text: before, preservedXmlFragments: [] },
      {
        id: `${id}-br`,
        text: '',
        preservedXmlFragments: ['<w:br w:type="page"/>'],
      },
      { id: `${id}-b`, text: after, preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [],
  }
}

function modelOf(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [],
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

describe('stored page breaks', () => {
  it('splits a mid-paragraph break at its offset, including first paragraph', () => {
    const pages = layoutDocument(
      modelOf([storedBreakParagraph('p1', 'abcdefghij', 'klmnopqrst')]),
    )
    expect(pages).toHaveLength(2)
    const first = pages[0]?.blocks[0]
    expect(first).toMatchObject({ from: 0, to: 10 })
    expect(first?.type).toBe('paragraph')
    if (first?.type === 'paragraph') expect(first.paragraph.id).toBe('p1')
    expect(pages[1]?.blocks[0]).toMatchObject({ from: 10, to: 20 })
  })

  it('splits a stored break below the sheet top instead of moving the paragraph', () => {
    const pages = layoutDocument(
      modelOf([
        paragraph('p0', 'lead'),
        storedBreakParagraph('p1', 'abcdefghij', 'klmnopqrst'),
      ]),
    )
    expect(pages).toHaveLength(2)
    expect(
      pages[0]?.blocks.flatMap((block) =>
        block.type === 'paragraph' ? [block.paragraph.id] : [],
      ),
    ).toEqual(['p0', 'p1'])
    expect(pages[0]?.blocks[1]).toMatchObject({ from: 0, to: 10 })
    expect(pages[1]?.blocks[0]).toMatchObject({ from: 10, to: 20 })
  })

  it('opens the post-break block on the body edge, whatever the continuation flag', () => {
    const indented: DocumentParagraphWire = {
      ...storedBreakParagraph('p1', 'abcdefghij', 'klmnopqrst'),
      preservedXmlFragments: ['<w:pPr><w:ind w:firstLine="720"/></w:pPr>'],
    }
    const pages = layoutDocument(modelOf([indented]))
    const before = pages[0]?.blocks[0]
    const after = pages[1]?.blocks[0]
    expect(before).toMatchObject({ from: 0, continuation: false })
    expect(after).toMatchObject({ from: 10, continuation: false })
  })

  it('keeps a document without a break on one sheet', () => {
    const pages = layoutDocument(modelOf([paragraph('p1', 'Hello')]))
    expect(pages).toHaveLength(1)
    expect(pages[0]?.blocks).toHaveLength(1)
  })
})
