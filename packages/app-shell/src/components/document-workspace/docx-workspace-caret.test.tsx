// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'

describe('DocxWorkspace vertical caret delivery', () => {
  const marker = 'ZXQMARK'
  // Each paragraph stays on one wrapped line at the default A4 width, so a
  // visual column is the caret offset and the assertions read directly.
  const staleModel = multiParagraphModel([
    paragraph('p1', 'A'.repeat(40)),
    paragraph('p2', `BBBBB${marker}${'C'.repeat(40)}`),
    paragraph('p3', 'D'.repeat(40)),
  ])

  function field(): HTMLTextAreaElement {
    const node = screen.getByLabelText('Paragraph text')
    if (!(node instanceof HTMLTextAreaElement)) {
      throw new Error('expected a paragraph editor')
    }
    return node
  }

  it('does not deliver a stale column past a pending insert into a later selection', () => {
    mountWorkspace({ models: { doc_1: staleModel } })
    // p1 holds the caret at column 40.
    fireEvent.click(screen.getByText('A'.repeat(40)))
    // A pending insert sits between p1 and p2; the vertical move crosses into
    // a destination that never mounts a ParagraphEditor.
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.click(screen.getByText('A'.repeat(40)))
    const editor = field()
    editor.focus()
    editor.setSelectionRange(40, 40)
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    expect(screen.getByLabelText('Pending paragraph text')).toBeTruthy()

    // Find -> Next places the caret at offset 5 of p2.
    openRibbonTab('Review')
    fireEvent.change(screen.getByLabelText('Find in document'), {
      target: { value: marker },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    const found = field()
    expect(found.selectionStart).toBe(5)

    // The next vertical move must use the freshly selected column (5), not the
    // column retained before the pending insert.
    fireEvent.keyDown(found, { key: 'ArrowDown' })
    expect(field().value).toBe('D'.repeat(40))
    expect(field().selectionStart).toBe(5)
  })

  it('clears the retained column when the same workspace switches documents', () => {
    const modelA = multiParagraphModel([
      paragraph('p1', 'A'.repeat(40)),
      paragraph('p2', 'B'.repeat(40)),
    ])
    const modelB = multiParagraphModel([
      paragraph('p1', 'X'.repeat(10)),
      paragraph('p2', 'Y'.repeat(10)),
      paragraph('p3', 'Z'.repeat(40)),
    ])
    const view = mountWorkspace({
      documentId: 'doc_1',
      models: { doc_1: modelA, doc_2: modelB },
    })
    fireEvent.click(screen.getByText('A'.repeat(40)))
    const editor = field()
    editor.focus()
    editor.setSelectionRange(40, 40)
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    expect(field().selectionStart).toBe(40)

    rerenderWorkspace(view, 'doc_2')

    // docB's p2 is short, so the restored caret clamps to 10. The first move
    // in the new document must derive its column from that caret, not the 40
    // retained from docA.
    const switched = field()
    expect(switched.value).toBe('Y'.repeat(10))
    switched.focus()
    switched.setSelectionRange(10, 10)
    fireEvent.keyDown(switched, { key: 'ArrowDown' })
    expect(field().value).toBe('Z'.repeat(40))
    expect(field().selectionStart).toBe(10)
  })
})
