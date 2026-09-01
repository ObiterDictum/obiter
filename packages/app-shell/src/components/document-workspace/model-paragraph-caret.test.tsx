// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { wrapLines } from '../../document-page-flow'
import { paragraphFace, paragraphLineHeightPx } from '../../document-page-style'
import { DocumentModelPage } from './model-view'

afterEach(() => {
  cleanup()
})

const wrapWidthPx = 80

function para(
  id: string,
  text: string,
  fragments: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [
      {
        id: `${id}-r`,
        text,
        preservedXmlFragments: fragments,
      },
    ],
    preservedXmlFragments: [],
  }
}

function doc(...paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function Harness({
  model,
  wrap,
  startId,
  startOffset,
}: {
  model: DocumentModelWire
  wrap?: boolean
  startId: string
  startOffset: number
}) {
  const [selected, setSelected] = useState<string | null>(startId)
  const [caret, setCaret] = useState<{
    paragraphId: string
    offset: number
  } | null>({ paragraphId: startId, offset: startOffset })
  const pageBlocks = wrap
    ? model.stories[0]?.paragraphs.map((paragraph) => ({
        type: 'paragraph' as const,
        paragraph,
        wrapWidthPx,
      }))
    : undefined
  return (
    <DocumentModelPage
      model={model}
      pageBlocks={pageBlocks}
      selectedParagraphId={selected}
      restoreCaret={caret}
      onSelectParagraph={(id, offset) => {
        setSelected(id)
        setCaret(offset == null ? null : { paragraphId: id, offset })
      }}
      editing
      onRunTextChange={() => undefined}
    />
  )
}

describe('run formatting when the caret is elsewhere', () => {
  it('renders a bold run at weight 700 when the paragraph does not hold the caret', () => {
    render(
      <DocumentModelPage
        model={doc(para('p1', 'Alice Example bold', ['<w:rPr><w:b/></w:rPr>']))}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const text = screen.getByText('Alice Example bold')
    expect(text.tagName).not.toBe('TEXTAREA')
    expect(text.style.fontWeight).toBe('700')
  })
})

describe('run formatting on the caret paragraph', () => {
  it('renders a uniformly bold paragraph textarea at weight 700', () => {
    render(
      <DocumentModelPage
        model={doc(para('p1', 'Alice Example bold', ['<w:rPr><w:b/></w:rPr>']))}
        selectedParagraphId="p1"
        restoreCaret={{ paragraphId: 'p1', offset: 0 }}
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    expect(field.style.fontWeight).toBe('700')
  })

  it('does not apply a run face when bold and plain runs share the slice', () => {
    render(
      <DocumentModelPage
        model={doc({
          id: 'p1',
          runs: [
            {
              id: 'r1',
              text: 'Bold',
              preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
            },
            {
              id: 'r2',
              text: 'plain',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        })}
        selectedParagraphId="p1"
        restoreCaret={{ paragraphId: 'p1', offset: 0 }}
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    expect(field.style.fontWeight).not.toBe('700')
  })
})

describe('click caret on a rendered paragraph', () => {
  it('selects the clicked character offset, not 0', () => {
    const selected: Array<{ id: string; offset?: number }> = []
    const model = doc(para('p1', 'Alice Example'))
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId={null}
        onSelectParagraph={(id, offset) => selected.push({ id, offset })}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const text = screen.getByText('Alice Example')
    const node = text.firstChild
    if (!(node instanceof Text)) throw new Error('expected text node')
    const caretPositionFromPoint = (
      document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => {
          offsetNode: Node
          offset: number
        } | null
      }
    ).caretPositionFromPoint
    Object.assign(document, {
      caretPositionFromPoint: () => ({ offsetNode: node, offset: 5 }),
    })
    fireEvent.click(text, { clientX: 24, clientY: 12 })
    Object.assign(document, { caretPositionFromPoint })
    expect(selected).toEqual([{ id: 'p1', offset: 5 }])
  })

  it('keeps a range when the pointer is released past the end of the text', () => {
    const selected: Array<{ id: string; offset?: number }> = []
    render(
      <DocumentModelPage
        model={doc(para('p1', 'Alice Example'))}
        selectedParagraphId="p1"
        restoreCaret={{ paragraphId: 'p1', offset: 5 }}
        onSelectParagraph={(id, offset) => selected.push({ id, offset })}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    field.setSelectionRange(5, 13)
    const paragraph = field.closest('[data-paragraph-id]')
    if (!(paragraph instanceof HTMLElement)) {
      throw new Error('expected a paragraph')
    }
    fireEvent.mouseDown(field, { clientX: 24, clientY: 12 })
    fireEvent.mouseMove(paragraph, { clientX: 80, clientY: 12 })
    fireEvent.mouseUp(paragraph, { clientX: 200, clientY: 12 })
    fireEvent.click(paragraph, { clientX: 200, clientY: 12 })
    expect(selected).not.toContainEqual({ id: 'p1', offset: 13 })
    expect(field.selectionStart).toBe(5)
    expect(field.selectionEnd).toBe(13)
  })

  it('places the caret at the clicked offset when there is no drag', () => {
    const selected: Array<{ id: string; offset?: number }> = []
    const model = doc(para('p1', 'Alice Example'))
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId={null}
        onSelectParagraph={(id, offset) => selected.push({ id, offset })}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const text = screen.getByText('Alice Example')
    const node = text.firstChild
    if (!(node instanceof Text)) throw new Error('expected text node')
    const caretPositionFromPoint = (
      document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => {
          offsetNode: Node
          offset: number
        } | null
      }
    ).caretPositionFromPoint
    Object.assign(document, {
      caretPositionFromPoint: () => ({ offsetNode: node, offset: 5 }),
    })
    fireEvent.mouseDown(text, { clientX: 24, clientY: 12 })
    fireEvent.mouseUp(text, { clientX: 24, clientY: 12 })
    fireEvent.click(text, { clientX: 24, clientY: 12 })
    Object.assign(document, { caretPositionFromPoint })
    expect(selected).toEqual([{ id: 'p1', offset: 5 }])
  })
})

describe('arrow keys across paragraphs', () => {
  const two = doc(para('p1', 'abcdef'), para('p2', 'ghijkl'))

  function field() {
    return screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
  }

  it('moves ArrowUp from the first visual line to the paragraph above, keeping the column', () => {
    render(<Harness model={two} startId="p2" startOffset={3} />)
    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    expect(field().value).toBe('abcdef')
    expect(field().selectionStart).toBe(3)
  })

  it('moves ArrowDown from the last visual line to the paragraph below, keeping the column', () => {
    render(<Harness model={two} startId="p1" startOffset={3} />)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('ghijkl')
    expect(field().selectionStart).toBe(3)
  })

  it('moves ArrowLeft at offset 0 to the end of the previous paragraph', () => {
    render(<Harness model={two} startId="p2" startOffset={0} />)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('abcdef')
    expect(field().selectionStart).toBe(6)
  })

  it('moves ArrowRight at the end to offset 0 of the next paragraph', () => {
    render(<Harness model={two} startId="p1" startOffset={6} />)
    fireEvent.keyDown(field(), { key: 'ArrowRight' })
    expect(field().value).toBe('ghijkl')
    expect(field().selectionStart).toBe(0)
  })

  it('clamps the desired column when the destination line is shorter', () => {
    render(
      <Harness
        model={doc(para('p1', 'ab'), para('p2', 'ghijkl'))}
        startId="p2"
        startOffset={5}
      />,
    )
    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    expect(field().value).toBe('ab')
    expect(field().selectionStart).toBe(2)
  })

  it('keeps ArrowDown inside a wrapped paragraph when not on the last visual line', () => {
    const text = 'alpha bravo charlie delta echo'
    const model = doc(para('p1', text), para('p2', 'next'))
    const face = paragraphFace(para('p1', text), [])
    const lines = wrapLines(
      text,
      face.run.fontSizePx ?? paragraphLineHeightPx(face),
      wrapWidthPx,
      face.run.fontFamily,
    )
    expect(lines.length).toBeGreaterThan(1)
    const first = lines[0]
    if (!first) throw new Error('expected a wrapped line')
    const moved: string[] = []
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[
          { type: 'paragraph', paragraph: para('p1', text), wrapWidthPx },
          { type: 'paragraph', paragraph: para('p2', 'next'), wrapWidthPx },
        ]}
        selectedParagraphId="p1"
        restoreCaret={{
          paragraphId: 'p1',
          offset: Math.max(0, first.to - 1),
        }}
        onSelectParagraph={(id, offset) => {
          if (offset != null) moved.push(id)
        }}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(moved).toEqual([])
    expect(field().value).toBe(text)
  })
})
