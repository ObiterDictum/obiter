import '@obiter/test-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  command,
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph } from './paragraph-selection-harness'

function noteDocument(readOnly = false) {
  const body = paragraph('body', 'Body text')
  const reference = (id: string, noteId: string) => ({
    id,
    text: '',
    preservedXmlFragments: [`<w:footnoteReference w:id="${noteId}"/>`],
  })
  body.runs.push(reference('ref', '3'))
  const second = paragraph('p2', 'Repeated reference')
  second.runs.push(reference('ref-2', '3'))
  const model = multiParagraphModel([body, second])
  model.stories.push({
    kind: 'footnotes',
    partName: 'word/footnotes.xml',
    paragraphs: [paragraph('note', 'Footnote text')],
    footnoteEntries: [{ id: '3', paragraphIds: ['note'], readOnly }],
    preservedXmlFragments: [
      '<w:footnote w:type="separator" w:id="-1"/>',
      '<w:footnote w:type="continuationSeparator" w:id="0"/>',
      '<w:footnote w:id="3"><w:p/></w:footnote>',
    ],
    fields: [],
    unanchoredFieldParagraphIds: [],
  })
  return { versionId: 'ver_1', versionNumber: 1, model }
}

it('opens the page footnote from either reference and returns focus to the activated reference', async () => {
  mountWorkspace({ modelFor: () => noteDocument() })
  const band = screen.getByRole('region', { name: 'Page footnotes' })
  expect(within(band).getByText('Footnote text')).toBeTruthy()
  const references = screen.getAllByRole('link', { name: 'Footnote 1' })
  expect(references).toHaveLength(2)
  const reference = references[1]
  if (!reference) throw new Error('Missing repeated reference')
  fireEvent.click(reference)
  const editor = screen.getByRole('textbox', { name: 'Paragraph text' })
  await waitFor(() => expect(document.activeElement === editor).toBe(true))
  expect(editor).toHaveProperty('value', 'Footnote text')
  fireEvent.click(
    within(band).getByRole('button', {
      name: 'Back to reference for footnote 1',
    }),
  )
  expect(document.activeElement === reference).toBe(true)
})

it('focuses the preserved-content notice for an unsupported footnote', () => {
  mountWorkspace({ modelFor: () => noteDocument(true) })
  const band = screen.getByRole('region', { name: 'Page footnotes' })
  expect(
    within(band).getByText(/The original DOCX content is preserved/),
  ).toBeTruthy()
  const reference = screen.getAllByRole('link', { name: 'Footnote 1' })[0]
  if (!reference) throw new Error('Missing reference')
  fireEvent.click(reference)
  const back = within(band).getByRole('button', {
    name: 'Back to reference for footnote 1',
  })
  expect(document.activeElement === back).toBe(true)
  expect(screen.queryByRole('textbox', { name: 'Paragraph text' })).toBeNull()
})

it('inserts at the caret from the command palette, renumbers and focuses the new note', async () => {
  mountWorkspace({ modelFor: () => noteDocument() })
  clickParagraph('body', 4)
  fireEvent.click(command('All commands'))
  const search = screen.getByRole('textbox', { name: 'Search commands' })
  fireEvent.change(search, { target: { value: 'Insert footnote' } })
  fireEvent.keyDown(search, { key: 'Enter' })
  const band = screen.getByRole('region', { name: 'Page footnotes' })
  const field = within(band).getByRole('textbox', { name: 'Paragraph text' })
  await waitFor(() => expect(document.activeElement === field).toBe(true))
  expect(field).toHaveProperty('value', '')
  expect(screen.getAllByRole('link', { name: 'Footnote 1' })).toHaveLength(1)
  expect(screen.getAllByRole('link', { name: 'Footnote 2' })).toHaveLength(2)
})
