import '@obiter/test-dom'
/*
 * E0: the editor must never reach a zero-paragraph state. These component
 * regressions pin the Delete paragraph availability, its accessible reason,
 * and that a refused deletion leaves no dirty document behind. The domain
 * matrix lives in document-edits.test.ts; this file proves the ribbon and the
 * caret-facing behaviour the save path depends on.
 */
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { LAST_PARAGRAPH_MESSAGE } from '../../document-edits'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { bodyField, clickParagraph } from './paragraph-selection-harness'

function deleteButton(): HTMLButtonElement {
  const button = screen.queryByRole('button', { name: /Delete paragraph/ })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Delete paragraph control is missing.')
  }
  return button
}

const saveButton = () => screen.getByRole('button', { name: 'Save' })

function renderedParagraphCount(): number {
  return new Set(
    [...document.querySelectorAll('[data-paragraph-id]')].map((node) =>
      node.getAttribute('data-paragraph-id'),
    ),
  ).size
}

/** The paragraph the caret currently holds, from the workspace's own marker. */
function selectedParagraphId(): string | null {
  return (
    document
      .querySelector('[data-paragraph-id][aria-current="true"]')
      ?.getAttribute('data-paragraph-id') ?? null
  )
}

function twoParagraphs() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

describe('last-paragraph deletion safety', () => {
  it('disables Delete paragraph with an accurate reason when one paragraph remains', () => {
    mountWorkspace({})

    const button = deleteButton()
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-label')).toBe(
      `Delete paragraph: ${LAST_PARAGRAPH_MESSAGE}`,
    )
    // The refused control cannot make the document dirty, so Save stays off.
    expect(saveButton()).toHaveProperty('disabled', true)
  })

  it('leaves the document unchanged when the disabled control is activated', () => {
    mountWorkspace({})
    clickParagraph('p1')

    fireEvent.click(deleteButton())

    expect(renderedParagraphCount()).toBe(1)
    expect(selectedParagraphId()).toBe('p1')
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('enables Delete paragraph after inserting a paragraph and disables it again on deletion', () => {
    mountWorkspace({})
    clickParagraph('p1')
    expect(deleteButton().disabled).toBe(true)

    // A pending inserted paragraph is an effective paragraph, so the guard
    // lifts as soon as the second paragraph exists.
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    expect(renderedParagraphCount()).toBe(2)
    expect(deleteButton().disabled).toBe(false)

    // Deleting the pending insert is safe and returns the document to one
    // effective paragraph, so the control disables again.
    fireEvent.click(deleteButton())
    expect(renderedParagraphCount()).toBe(1)
    expect(deleteButton().disabled).toBe(true)
    expect(saveButton()).toHaveProperty('disabled', true)
  })

  it('deletes one of two paragraphs, marks the document dirty, and restores it on undo', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    expect(deleteButton().disabled).toBe(false)

    fireEvent.click(deleteButton())

    // One paragraph survives, it holds the caret, and the deletion is a real
    // pending operation the Save can persist.
    expect(renderedParagraphCount()).toBe(1)
    expect(selectedParagraphId()).toBe('p1')
    expect(bodyField().value).toBe('Hello')
    expect(document.activeElement).toBe(bodyField())
    expect(deleteButton().disabled).toBe(true)
    expect(saveButton()).toHaveProperty('disabled', false)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(renderedParagraphCount()).toBe(2)
    expect(deleteButton().disabled).toBe(false)
  })

  it('keeps the second deletion refused after a valid first deletion', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    fireEvent.click(deleteButton())

    // Only p1 is left, and the control is unavailable for it.
    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().getAttribute('aria-label')).toBe(
      `Delete paragraph: ${LAST_PARAGRAPH_MESSAGE}`,
    )
    expect(renderedParagraphCount()).toBe(1)
  })
})
