import '@obiter/test-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import { DocumentModelPage } from './model-view'

function paragraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] as string[] }],
    preservedXmlFragments: [] as string[],
  }
}

/** A body paragraph whose tail run carries a stored `w:footnoteReference`
 * — the wire the parser emits for the mark. */
const body = {
  partName: 'word/document.xml',
  kind: 'document' as const,
  paragraphs: [
    {
      id: 'p1',
      runs: [
        { id: 'p1-r', text: 'Body text', preservedXmlFragments: [] },
        {
          id: 'p1-ref',
          text: '',
          preservedXmlFragments: ['<w:footnoteReference w:id="2"/>'],
        },
      ],
      preservedXmlFragments: [] as string[],
    },
  ],
  preservedXmlFragments: [] as string[],
  fields: [],
  unanchoredFieldParagraphIds: [],
}

const footnotes = {
  partName: 'word/footnotes.xml',
  kind: 'footnotes' as const,
  paragraphs: [paragraph('sep', ''), paragraph('n1', 'A note')],
  preservedXmlFragments: [
    '<w:footnote w:type="separator" w:id="-1"><w:p w14:paraId="S"/></w:footnote>',
    '<w:footnote w:id="2"><w:p w14:paraId="N1"/></w:footnote>',
  ],
  fields: [],
  unanchoredFieldParagraphIds: [],
}

const endnotes = {
  partName: 'word/endnotes.xml',
  kind: 'endnotes' as const,
  paragraphs: [paragraph('e1', 'An endnote')],
  preservedXmlFragments: [
    '<w:endnote w:id="3"><w:p w14:paraId="E1"/></w:endnote>',
  ],
  fields: [],
  unanchoredFieldParagraphIds: [],
}

const model: DocumentModelWire = {
  version: 1,
  stories: [body, footnotes],
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

/** The laid-out blocks the page renders: the body paragraph, then the note
 * bodies the paginator appends at the foot of the page. */
const blocks = [
  { type: 'paragraph' as const, paragraph: body.paragraphs[0]! },
  { type: 'paragraph' as const, paragraph: footnotes.paragraphs[1]! },
]

afterEach(() => {
  cleanup()
})

describe('a painted footnote body', () => {
  it('opens the notes story at the clicked paragraph', () => {
    const opened: string[] = []
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={blocks}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        onOpenNoteEditing={(id) => opened.push(id)}
        editing
      />,
    )
    fireEvent.click(screen.getByText('A note'), { clientX: 24, clientY: 12 })
    expect(opened).toEqual(['n1'])
  })

  it('stays read-only paint while the story is closed', () => {
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={blocks}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        editing
      />,
    )
    expect(
      screen
        .getByText('A note')
        .closest('[data-paragraph-id]')
        ?.querySelector('textarea'),
    ).toBeNull()
  })

  it('paints editable while its story is open', () => {
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={blocks}
        marginEditing={footnotes}
        selectedParagraphId="n1"
        onSelectParagraph={() => undefined}
        editing
      />,
    )
    expect(screen.getByLabelText('Paragraph text')).toBeTruthy()
    // The body takes no caret while the notes story is open.
    expect(
      screen
        .getByText('Body text')
        .closest('[data-paragraph-id]')
        ?.querySelector('textarea'),
    ).toBeNull()
  })

  it('does not open the story for an endnote body', () => {
    const opened: string[] = []
    const endnoted: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...body,
          paragraphs: [
            {
              id: 'p1',
              runs: [
                { id: 'p1-r', text: 'Body text', preservedXmlFragments: [] },
                {
                  id: 'p1-ref',
                  text: '',
                  preservedXmlFragments: ['<w:endnoteReference w:id="3"/>'],
                },
              ],
              preservedXmlFragments: [] as string[],
            },
          ],
        },
        endnotes,
      ],
    }
    render(
      <DocumentModelPage
        model={endnoted}
        pageBlocks={[
          { type: 'paragraph', paragraph: body.paragraphs[0]! },
          { type: 'paragraph', paragraph: endnotes.paragraphs[0]! },
        ]}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        onOpenNoteEditing={(id) => opened.push(id)}
        editing
      />,
    )
    fireEvent.click(screen.getByText('An endnote'), {
      clientX: 24,
      clientY: 12,
    })
    expect(opened).toEqual([])
  })
})
