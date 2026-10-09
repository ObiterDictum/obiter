import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { layoutDocument } from './document-page-engine'

/*
 * A page break is addressed by the text offset it sits at, whether it is still
 * pending in a draft or already stored in the model. The stored path used to
 * advance the whole paragraph, so a reloaded mid-paragraph break rendered as a
 * single sheet and disagreed with the editor that produced it.
 */

function paragraph(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

/** A paragraph as it reloads after a break was written mid-run: a standalone
 * break run between the text before and after the break. */
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

  it('keeps a document without a break on one sheet', () => {
    const pages = layoutDocument(modelOf([paragraph('p1', 'Hello')]))
    expect(pages).toHaveLength(1)
    expect(pages[0]?.blocks).toHaveLength(1)
  })
})
