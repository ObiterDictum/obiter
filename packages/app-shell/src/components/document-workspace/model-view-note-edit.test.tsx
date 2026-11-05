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
  trackRevisions: false,
  markings: {
    documentKind: null,
    draft: false,
    privileged: false,
    withoutPrejudice: false,
  },
}

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

describe('the page footnote band', () => {
  const box = {
    widthPx: 794,
    heightPx: 1123,
    margin: { top: 96, right: 96, bottom: 96, left: 96 },
    headerPx: 48,
    footerPx: 48,
  }
  const frame = {
    top: 96,
    right: 96,
    bottom: 96,
    left: 96,
    widthPx: 602,
    heightPx: 931,
  }
  const page = (note: (typeof blocks)[number] & { from?: number }) => (
    <DocumentModelPage
      model={model}
      pageBlocks={[blocks[0]!]}
      pageLayout={{
        box,
        frame,
        columns: [{ left: 0, widthPx: 602 }],
        footnotes: { blocks: [note], heightPx: 60 },
      }}
      selectedParagraphId={null}
      onSelectParagraph={() => undefined}
    />
  )

  it('opens with a short separator rule above the first note on the page', () => {
    const { container } = render(page(blocks[1]!))
    const band = screen.getByLabelText('Page footnotes')
    const rule = band.firstElementChild as HTMLElement
    expect(rule.dataset.footnoteSeparator).toBe('separator')
    expect(rule.style.width).toBe('192px')
    expect(container.querySelector('[data-note-mark]')?.textContent).toBe('1')
    expect(band.textContent).toContain('1')
  })

  it('runs the rule the full width when a note continues from the previous page', () => {
    render(page({ ...blocks[1]!, from: 3 }))
    const rule = screen.getByLabelText('Page footnotes')
      .firstElementChild as HTMLElement
    expect(rule.dataset.footnoteSeparator).toBe('continuation')
    expect(rule.style.width).toBe('100%')
  })
})
