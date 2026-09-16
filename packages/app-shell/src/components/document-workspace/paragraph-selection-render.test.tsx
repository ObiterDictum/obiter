// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { DocumentModelPage } from './model-view'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import { selectedText } from './paragraph-selection-harness'

afterEach(() => {
  cleanup()
})

const handlers: ParagraphSelectionHandlers = {
  active: true,
  direction: 'forward',
  onExtend: () => undefined,
  onCollapse: () => undefined,
  onSelectAll: () => undefined,
  onReplaceRange: () => undefined,
  onDeleteRange: () => undefined,
  onSplitRange: () => undefined,
  onCopyRange: () => undefined,
  onCutRange: () => undefined,
  onClear: () => undefined,
  onRejectInput: () => undefined,
  onEscapeBlur: () => undefined,
}

function para(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function doc(...paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: 'word/document.xml',
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

function renderPage(
  model: DocumentModelWire,
  segments: Record<string, { from: number; to: number }>,
  blocks?: Array<{
    type: 'paragraph'
    paragraph: DocumentParagraphWire
    from?: number
    to?: number
    wrapWidthPx?: number
    continuation?: boolean
  }>,
) {
  return render(
    <DocumentModelPage
      model={model}
      pageBlocks={
        blocks ??
        model.stories[0]?.paragraphs.map((paragraph) => ({
          type: 'paragraph' as const,
          paragraph,
          wrapWidthPx: 420,
        }))
      }
      selectedParagraphId={null}
      onSelectParagraph={() => undefined}
      editing
      selectionSegments={new Map(Object.entries(segments))}
      selectionHandlers={handlers}
    />,
  ).container
}

describe('painting a document selection', () => {
  it('marks the segment of every covered paragraph and nothing else', () => {
    const container = renderPage(
      doc(para('p1', 'Alpha'), para('p2', 'Bravo'), para('p3', 'Charlie')),
      { p1: { from: 3, to: 5 }, p2: { from: 0, to: 5 } },
    )
    expect(container.querySelectorAll('[data-selected-text]')).toHaveLength(2)
    expect(selectedText('p1')).toBe('ha')
    expect(selectedText('p2')).toBe('Bravo')
    expect(selectedText('p3')).toBe('')
  })

  it('paints nothing for a collapsed segment', () => {
    const container = renderPage(
      doc(para('p1', 'Alpha'), para('p2', 'Bravo')),
      { p1: { from: 5, to: 5 }, p2: { from: 0, to: 0 } },
    )
    expect(container.querySelectorAll('[data-selected-text]')).toHaveLength(0)
  })

  it('marks the empty row of an empty paragraph in the range', () => {
    const container = renderPage(
      doc(para('p1', 'Alpha'), para('p2', ''), para('p3', 'Charlie')),
      {
        p1: { from: 5, to: 5 },
        p2: { from: 0, to: 0 },
        p3: { from: 0, to: 0 },
      },
    )
    // The empty paragraph paints one blank row; the other two cover no text.
    expect(container.querySelectorAll('[data-selected-text]')).toHaveLength(1)
    expect(selectedText('p2')).toBe('\u00a0')
  })

  it('splits a wrapped paragraph mark across its visual rows', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(4).trim()
    const model = doc(para('p1', text))
    // The range is chosen from the rendered rows, so the test does not depend
    // on where the projection decides to wrap.
    const probe = renderPage(model, {})
    const rows = [...probe.querySelectorAll('[data-line-from]')]
    cleanup()
    expect(rows.length).toBeGreaterThan(1)
    const first = rows[0]
    const second = rows[1]
    if (!first || !second) throw new Error('expected wrapped rows')
    const from = Number(first.getAttribute('data-line-from')) + 2
    const to = Number(second.getAttribute('data-line-to')) - 3

    const container = renderPage(model, { p1: { from, to } })
    const markedPerRow = [
      ...container.querySelectorAll('[data-line-from]'),
    ].map((row) =>
      [...row.querySelectorAll('[data-selected-text]')]
        .map((node) => node.textContent ?? '')
        .join(''),
    )
    expect(markedPerRow.join('')).toBe(text.slice(from, to))
    expect(markedPerRow.filter((row) => row.length > 0)).toHaveLength(2)
  })

  it('keeps a hard break with the row it terminates', () => {
    const container = renderPage(doc(para('p1', 'one\ntwo')), {
      p1: { from: 3, to: 6 },
    })
    const rows = [...container.querySelectorAll('[data-line-from]')]
    expect(rows).toHaveLength(2)
    // The newline slot at offset 3 belongs to the first row, so the range
    // paints from the second row's start.
    expect(rows[0]?.querySelector('[data-selected-text]')).toBeNull()
    expect(selectedText('p1')).toBe('tw')
  })

  it('marks the empty visual row a trailing hard break opens', () => {
    const container = renderPage(doc(para('p1', 'one\n')), {
      p1: { from: 2, to: 4 },
    })
    const rows = [...container.querySelectorAll('[data-line-from]')]
    expect(rows).toHaveLength(2)
    expect(selectedText('p1')).toBe('e\u00a0')
  })

  it('marks only the code units a page fragment owns', () => {
    const paragraph = para('p1', 'Alpha')
    const container = renderPage(doc(paragraph), { p1: { from: 1, to: 4 } }, [
      { type: 'paragraph', paragraph, from: 0, to: 2, wrapWidthPx: 420 },
      {
        type: 'paragraph',
        paragraph,
        from: 2,
        to: 5,
        wrapWidthPx: 420,
        continuation: true,
      },
    ])
    // Each block paints only the part of the range inside its own slice.
    expect(container.querySelectorAll('[data-selected-text]')).toHaveLength(2)
    expect(selectedText('p1')).toBe('lph')
  })

  it('does not mark a paragraph the selection does not cover', () => {
    const container = renderPage(
      doc(para('p1', 'Alpha'), para('p2', 'Bravo')),
      { p1: { from: 0, to: 5 } },
    )
    expect(container.querySelectorAll('[data-selected-text]')).toHaveLength(1)
    expect(selectedText('p2')).toBe('')
    // The page chrome carries no selection marks either.
    expect(
      container.querySelectorAll(
        '[aria-label="Document body"] [data-selected-text]',
      ).length,
    ).toBe(1)
  })
})
