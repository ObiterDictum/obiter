import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  selectedText,
  selectionStatus,
} from './paragraph-selection-harness'

function model() {
  return multiParagraphModel([
    paragraph('p1', 'Alpha'),
    paragraph('p2', 'Bravo'),
    paragraph('p3', 'Charlie'),
  ])
}

/** Selects p1 offset 4 to p2 offset 2, leaving the caret in p2. */
function selectAcrossBoundary() {
  clickParagraph('p1')
  nativeSelect(4, 5)
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  expect(selectionStatus()).toMatch(/2 paragraphs selected/)
}

describe('selection scope', () => {
  it('drops the selection when another document is opened', () => {
    const models = {
      doc_1: model(),
      doc_2: multiParagraphModel([
        paragraph('q1', 'Delta'),
        paragraph('q2', 'Echo'),
      ]),
    }
    const editAsync = vi.fn()
    const view = mountWorkspace({ models, editAsync })
    selectAcrossBoundary()

    rerenderWorkspace(view, 'doc_2')
    expect(selectionStatus()).toBe('')
    expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
    // A paragraph of the new document is not silently partially selected.
    expect(selectedText('q1')).toBe('')
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('clamps a selection to the text a reopened version still holds', () => {
    const models = { doc_1: model() }
    const view = mountWorkspace({ models, editAsync: vi.fn() })
    selectAcrossBoundary()

    // The reopened version keeps the paragraph ids but its first paragraph is
    // shorter, so the anchor is clamped rather than left past its end.
    models.doc_1 = multiParagraphModel([
      paragraph('p1', 'Al'),
      paragraph('p2', 'Br'),
      paragraph('p3', 'Charlie'),
    ])
    rerenderWorkspace(view, 'doc_1')
    expect(selectedText('p1')).toBe('')
    expect(selectedText('p2')).toBe('Br')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })

  it('clears the selection when the paragraph holding it is deleted', () => {
    mountWorkspace({ models: { doc_1: model() }, editAsync: vi.fn() })
    selectAcrossBoundary()
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    expect(selectionStatus()).toBe('')
    expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
    expect(screen.queryByText('Bravo')).toBeNull()
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('clears the selection when a find hit moves the caret', () => {
    mountWorkspace({ models: { doc_1: model() }, editAsync: vi.fn() })
    selectAcrossBoundary()
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    fireEvent.change(screen.getByLabelText('Find in document'), {
      target: { value: 'Charlie' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(selectionStatus()).toBe('')
    expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
    expect(bodyField().value).toBe('Charlie')
  })
})
