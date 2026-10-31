import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import {
  paragraphRenderCounts,
  resetParagraphRenderCounts,
} from './model-paragraph'

const PARAGRAPH_COUNT = 300

function bodyModel() {
  return multiParagraphModel(
    Array.from({ length: PARAGRAPH_COUNT }, (_, index) =>
      paragraph(`p${index}`, `Paragraph ${index} text`),
    ),
  )
}

it('typing into one paragraph re-renders only the edited paragraph', () => {
  mountWorkspace({ models: { doc_1: bodyModel() } })
  fireEvent.click(screen.getByText('Paragraph 0 text'))
  const field = screen.getByLabelText('Paragraph text')
  resetParagraphRenderCounts()
  fireEvent.change(field, { target: { value: 'Paragraph 0 textX' } })
  expect(paragraphRenderCounts.total).toBeLessThanOrEqual(5)
  expect(paragraphRenderCounts.byId.get('p0')).toBe(1)
  expect(paragraphRenderCounts.byId.has('p1')).toBe(false)
})
