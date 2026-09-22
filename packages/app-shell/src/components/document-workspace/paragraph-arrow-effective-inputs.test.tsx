// @vitest-environment jsdom
/*
 * E61: the caret must read the paragraph the layout painted. Two inputs the
 * pagination path merges in are invisible to a stored-only reading: text an
 * edit holds in `extraRuns`, and a pending paragraph format. ArrowLeft into
 * such a paragraph used to land at offset 0 instead of its visible end, and
 * vertical moves resolved columns against lines that were never painted.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { formattedModel } from '../../document-format-edits'
import type { FormatDrafts } from '../../document-format-types'
import { wrapLines } from '../../document-page-flow'
import { contentFrame, documentPageBox } from '../../document-page-layout'
import { marginBandHeights } from '../../document-page-margin'
import { paragraphFace } from '../../document-page-style'
import { blockEndOffset, paragraphClickCaret } from './model-click-caret'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'

function field(): HTMLTextAreaElement {
  const editor = screen.getByLabelText('Paragraph text')
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error('Paragraph field is missing.')
  }
  return editor
}

/** Body p0 'head', p1 with no stored runs, p2 'world', p3 'tail'. */
function joinModel(): DocumentModelWire {
  return multiParagraphModel([
    paragraph('p0', 'head'),
    { id: 'p1', runs: [], preservedXmlFragments: [] },
    paragraph('p2', 'world'),
    paragraph('p3', 'tail'),
  ])
}

/** Click the first paragraph so the workspace holds a caret to move. */
function focusFirstParagraph() {
  fireEvent.click(screen.getByText('head'))
}

function joinP2IntoP1() {
  // p0 -> p1 (empty) -> p2; the empty p1 owns no stored runs.
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  fireEvent.keyDown(field(), { key: 'ArrowDown' })
  expect(field().value).toBe('world')
  // Backspace at offset 0 joins p2 into p1. The text has no home among p1's
  // stored runs, so the edit holds it in `extraRuns`; layout, save and the
  // caret all read it as p1's visible text.
  field().setSelectionRange(0, 0)
  fireEvent.keyDown(field(), { key: 'Backspace' })
  expect(field().value).toBe('world')
}

describe('ArrowLeft into a paragraph whose visible text is an extra run', () => {
  it('lands at the visible end after Backspace joins the text into it', () => {
    mountWorkspace({ models: { doc_1: joinModel() } })
    focusFirstParagraph()
    joinP2IntoP1()

    // p1 -> p3, then ArrowLeft back across the paragraph break.
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('tail')
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('world')
    expect(field().selectionStart).toBe(5)
  })

  it('keeps the visible end across a later edit and undo', () => {
    mountWorkspace({ models: { doc_1: joinModel() } })
    focusFirstParagraph()
    joinP2IntoP1()

    // Typing extends the joined paragraph beyond its stored runs.
    fireEvent.change(field(), { target: { value: 'worlds' } })
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('worlds')
    expect(field().selectionStart).toBe(6)

    // Undo rewinds the typed text; the join itself is a separate operation.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(field().value).toBe('world')
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('world')
    expect(field().selectionStart).toBe(5)
  })

  it('saves the visible text and lands on the same end after a refetch', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    // The refetched document carries the join as a stored run on p1.
    const refetched = multiParagraphModel([
      paragraph('p0', 'head'),
      paragraph('p1', 'world'),
      paragraph('p3', 'tail'),
    ])
    const view = mountWorkspace({
      models: { doc_1: joinModel(), doc_2: refetched },
      editAsync,
    })
    focusFirstParagraph()
    joinP2IntoP1()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(1)
    })
    const payload = editAsync.mock.calls[0]?.[0] as {
      operations: Array<{ type: string; text?: string }>
    }
    const join = payload.operations.find(
      (op) => op.type === 'insert_paragraph_after',
    )
    expect(join?.text).toBe('world')

    rerenderWorkspace(view, 'doc_2')
    fireEvent.click(screen.getByText('head'))
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('world')
    expect(field().selectionStart).toBe(5)
  })
})

const SMALL_STYLE = {
  styleId: 'Small',
  sourceFragment:
    '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:rPr><w:sz w:val="8"/></w:rPr></w:style>',
}

function formatDrafts(paragraphId: string): FormatDrafts {
  return {
    emphasis: [],
    paragraphStyles: { [paragraphId]: 'Small' },
    numbering: {},
  }
}

describe('vertical moves follow the lines the pending format paints', () => {
  // Small enough that the 4pt face fits one line where the stored 11pt face
  // wraps to two: the two readings disagree about which line is the last.
  const LONG = Array.from(
    { length: 6 },
    () => 'alpha bravo charlie delta',
  ).join(' ')

  function styledModel(): DocumentModelWire {
    return {
      ...multiParagraphModel([paragraph('p1', LONG), paragraph('p2', 'tail')]),
      styles: [SMALL_STYLE],
    }
  }

  it('resolves ArrowUp against the painted last line, not the stored one', () => {
    const model = styledModel()
    const painted = formattedModel(model, formatDrafts('p1'))
    const storedP1 = paragraph('p1', LONG)
    const paintedP1 = painted.stories[0]?.paragraphs[0]
    if (!paintedP1) throw new Error('painted paragraph missing')
    const frame = contentFrame(documentPageBox(model), marginBandHeights(model))
    const paintedLines = wrapLines(
      LONG,
      paragraphFace(paintedP1, model.styles).run.fontSizePx ?? 16,
      frame.widthPx,
    )
    const storedLines = wrapLines(
      LONG,
      paragraphFace(storedP1, model.styles).run.fontSizePx ?? 16,
      frame.widthPx,
    )
    // The fixture only proves anything while the two readings differ.
    expect(paintedLines.length).toBe(1)
    expect(storedLines.length).toBeGreaterThan(1)

    mountWorkspace({ models: { doc_1: model } })
    const paragraphEl = document.querySelector('[data-paragraph-id="p1"]')
    if (!(paragraphEl instanceof HTMLElement)) {
      throw new Error('expected the first paragraph')
    }
    fireEvent.click(paragraphEl)
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))

    // Cross into p2 horizontally first, which places the caret at offset 0
    // and starts a fresh vertical column rather than retaining one.
    field().setSelectionRange(LONG.length, LONG.length)
    fireEvent.keyDown(field(), { key: 'ArrowRight' })
    expect(field().value).toBe('tail')
    expect(field().selectionStart).toBe(0)
    // Back up at column 0. The column resolves against the neighbour's line
    // model: the one painted here, or the stored 11pt one on the defect.
    fireEvent.keyDown(field(), { key: 'ArrowUp' })
    expect(field().value).toBe(LONG)
    expect(field().selectionStart).toBe(0)
  })
})

describe('click caret end offset', () => {
  it('clamps a click to the visible length, extra runs included', () => {
    const paragraphs = [{ id: 'p1', runs: [], preservedXmlFragments: [] }]
    const extraRuns = {
      p1: [{ id: 'p2-r', text: 'world', preservedXmlFragments: [] }],
    }
    expect(blockEndOffset('p1', paragraphs, undefined, [], extraRuns)).toBe(5)

    const root = document.createElement('div')
    const paragraphEl = document.createElement('div')
    paragraphEl.dataset.paragraphId = 'p1'
    const textRoot = document.createElement('div')
    textRoot.setAttribute('data-paragraph-text', '')
    textRoot.textContent = 'world'
    paragraphEl.append(textRoot)
    root.append(paragraphEl)
    document.body.append(root)
    const node = textRoot.firstChild
    if (!(node instanceof Text)) throw new Error('expected a text node')
    const original = document.caretPositionFromPoint
    Object.assign(document, {
      caretPositionFromPoint: () => ({ offsetNode: node, offset: 5 }),
    })
    const caret = paragraphClickCaret(paragraphEl, 12, 12, root, (id) =>
      blockEndOffset(id, paragraphs, undefined, [], extraRuns),
    )
    Object.assign(document, { caretPositionFromPoint: original })
    root.remove()
    expect(caret).toEqual({ paragraphId: 'p1', offset: 5 })
  })
})
