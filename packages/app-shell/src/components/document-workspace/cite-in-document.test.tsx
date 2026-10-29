import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { fireEvent, screen, within } from '@testing-library/react'
import { readPendingCitation } from '../../pending-citation'
import { setTrackChanges } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph } from './paragraph-selection-harness'

/*
 * "Cite in document": a source page leaves the citation for one document and
 * the editor asks where it goes. Nothing is written until Insert, the insertion
 * is the document's own (so track changes decides whether it is tracked), and
 * both answers drop the request.
 */

const CITATION = 'Wood v Capita Insurance Services Ltd [2017] UKSC 24'
const TEXT = 'Order 60,000'

function citationBar() {
  return screen.queryByRole('form', { name: 'Pending citation' })
}

function insertButton() {
  const bar = citationBar()
  if (!bar) throw new Error('the citation bar is not on screen')
  return within(bar).getByRole('button', { name: 'Insert' })
}

function orderDocument() {
  mountWorkspace({
    models: { doc_1: multiParagraphModel([paragraph('p1', TEXT)]) },
    pendingCitation: CITATION,
  })
}

it('inserts the pending citation at the caret as plain text when tracking is off', () => {
  orderDocument()
  expect(citationBar()).toBeTruthy()
  clickParagraph('p1', TEXT.length)
  fireEvent.click(insertButton())

  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Paragraph text').value,
  ).toBe(`${TEXT}${CITATION}`)
  expect(document.querySelector('[data-inline-change]')).toBeNull()
  expect(citationBar()).toBeNull()
  expect(readPendingCitation('doc_1')).toBeNull()
})

it('inserts the pending citation as a tracked insertion when tracking is on', () => {
  orderDocument()
  setTrackChanges(true)
  clickParagraph('p1', TEXT.length)
  fireEvent.click(insertButton())

  const inserted = [
    ...document.querySelectorAll('[data-inline-change][role="insertion"]'),
  ].map((node) => node.textContent)
  expect(inserted).toContain(CITATION)
  expect(readPendingCitation('doc_1')).toBeNull()
})

it('discards the pending citation on Cancel, leaving the document untouched', () => {
  orderDocument()
  clickParagraph('p1', TEXT.length)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Paragraph text').value,
  ).toBe(TEXT)
  expect(citationBar()).toBeNull()
  expect(readPendingCitation('doc_1')).toBeNull()
})

it('refuses to insert before the reader has placed the caret', () => {
  orderDocument()
  expect(insertButton()).toHaveProperty('disabled', true)
  expect(
    screen.getByText('Place the cursor where the citation goes'),
  ).toBeTruthy()
})
