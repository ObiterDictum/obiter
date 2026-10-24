import { editableRangeText } from './inline-change-review'
import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph } from './paragraph-selection-harness'

it('paints unsaved tracked replacements while keeping inserted text editable and the save batch unchanged', async () => {
  const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
  mountWorkspace({
    models: {
      doc_1: multiParagraphModel([paragraph('p1', 'Order 60,000 units')]),
    },
    editAsync,
  })
  openRibbonTab('Review')
  fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
  clickParagraph('p1')
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  fireEvent.change(field, { target: { value: 'Order 45,000 units' } })
  const marks = () => [
    ...document.querySelectorAll(
      '[data-caret-run-overlay] [data-inline-change]',
    ),
  ]
  expect(
    marks().map((node) => [node.getAttribute('role'), node.textContent]),
  ).toEqual([
    ['deletion', '60,000'],
    ['insertion', '45,000'],
  ])
  expect(field.value).toBe('Order 60,00045,000 units')
  const overlay = document.querySelector('[data-caret-run-overlay]')
  if (!overlay) throw new Error('Missing paragraph overlay')
  const range = document.createRange()
  range.selectNodeContents(overlay)
  expect(editableRangeText(range)).toBe('Order 45,000 units')
  field.setSelectionRange(18, 18)
  fireEvent.keyDown(field, { key: 'Backspace' })
  expect(marks().map((node) => node.textContent)).toEqual(['60,000', '45,00'])
  fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
  expect(marks().map((node) => node.textContent)).toEqual(['60,000', '45,000'])
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(editAsync).toHaveBeenCalled())
  expect(editAsync.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      operations: [
        { type: 'replace_run_text', runId: 'p1-r', text: 'Order 45,000 units' },
      ],
      trackChanges: true,
    }),
  )
})
