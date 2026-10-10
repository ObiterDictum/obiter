import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { documentOutline } from './document-outline'

const HEADING_STYLE: DocumentStyleWire = {
  styleId: 'Heading1',
  sourceFragment:
    '<w:style w:type="paragraph"><w:name w:val="Heading 1"/></w:style>',
}

function paragraph(
  id: string,
  text: string,
  extra: Partial<DocumentParagraphWire> = {},
): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
    ...extra,
  }
}

function modelOf(
  paragraphs: DocumentParagraphWire[],
  styles: DocumentStyleWire[] = [],
): DocumentModelWire {
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
    styles,
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

describe('documentOutline', () => {
  it('is empty when no paragraph sits at an outline level', () => {
    expect(
      documentOutline(
        modelOf([paragraph('p1', 'A body paragraph.')], [HEADING_STYLE]),
      ),
    ).toEqual([])
  })

  it('collects headings in flow order through the built-in style id', () => {
    const entries = documentOutline(
      modelOf(
        [
          paragraph('p1', 'Body before.'),
          paragraph('p2', 'First heading', { styleId: 'Heading1' }),
          paragraph('p3', 'Body after.'),
          paragraph('p4', 'Second heading', { styleId: 'Heading1' }),
        ],
        [HEADING_STYLE],
      ),
    )
    expect(entries).toEqual([
      { paragraphId: 'p2', level: 1, text: 'First heading' },
      { paragraphId: 'p4', level: 1, text: 'Second heading' },
    ])
  })

  it('resolves a direct w:outlineLvl paragraph property', () => {
    const entries = documentOutline(
      modelOf([
        paragraph('p1', 'Outlined', {
          preservedXmlFragments: ['<w:pPr><w:outlineLvl w:val="1"/></w:pPr>'],
        }),
      ]),
    )
    expect(entries).toEqual([{ paragraphId: 'p1', level: 2, text: 'Outlined' }])
  })

  it('names the heading its drafted text, not the stored text', () => {
    const entries = documentOutline(
      modelOf(
        [paragraph('p1', 'Stored heading', { styleId: 'Heading1' })],
        [HEADING_STYLE],
      ),
      { 'p1-r': 'Drafted heading' },
    )
    expect(entries[0]?.text).toBe('Drafted heading')
  })

  it('lists a paragraph its pending style draft just made a heading', () => {
    const entries = documentOutline(
      modelOf([paragraph('p1', 'Fresh heading')], [HEADING_STYLE]),
      {},
      {},
      { p1: 'Heading1' },
    )
    expect(entries).toEqual([
      { paragraphId: 'p1', level: 1, text: 'Fresh heading' },
    ])
  })

  it('drops a heading its pending style draft cleared', () => {
    const entries = documentOutline(
      modelOf(
        [paragraph('p1', 'Was a heading', { styleId: 'Heading1' })],
        [HEADING_STYLE],
      ),
      {},
      {},
      { p1: null },
    )
    expect(entries).toEqual([])
  })
})
