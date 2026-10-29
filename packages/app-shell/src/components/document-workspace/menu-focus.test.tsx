import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { command } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph } from './paragraph-selection-harness'

/*
 * A command run from the menu bar hands the caret back to the document. The
 * menu restores focus to its own trigger, so the workspace re-focuses the
 * caret's field once the menu has finished closing — otherwise the next typed
 * character goes nowhere, which is what the old ribbon's mousedown guard
 * prevented.
 */

function activeField() {
  const active = document.activeElement
  return (
    active instanceof HTMLElement &&
    active.closest('[data-paragraph-id]') !== null
  )
}

it('returns focus to the surviving paragraph after Delete paragraph', async () => {
  mountWorkspace({
    models: {
      doc_1: multiParagraphModel([
        paragraph('p1', 'First paragraph'),
        paragraph('p2', 'Second paragraph'),
      ]),
    },
  })
  clickParagraph('p2', 0)
  fireEvent.click(command('Delete paragraph'))

  await waitFor(() => expect(activeField()).toBe(true))
  expect(document.activeElement?.getAttribute('aria-label')).toBe(
    'Paragraph text',
  )
})

it('returns focus to the footnote text after opening the notes', async () => {
  mountWorkspace({
    models: { doc_1: multiParagraphModel([paragraph('p1', 'Order 60,000')]) },
  })
  clickParagraph('p1', 5)
  fireEvent.click(command('Footnote'))

  await waitFor(() => expect(activeField()).toBe(true))
  expect(document.activeElement?.getAttribute('aria-label')).toBe(
    'Paragraph text',
  )
})
