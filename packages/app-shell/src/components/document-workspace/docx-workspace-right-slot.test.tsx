import '@obiter/test-dom'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentComment } from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { bodyField } from './paragraph-selection-harness'

const model = () =>
  multiParagraphModel([
    paragraph('p1', 'This lease is made today.'),
    paragraph('p2', 'The "Consultancy Fee" is payable monthly.'),
  ])

function rightSlot() {
  return within(screen.getByRole('complementary', { name: 'Right slot' }))
}

describe('document workspace in the right slot', () => {
  it('lists the defined-term finding the open Checks tab computes and jumps to its paragraph', () => {
    mountWorkspace({ models: { doc_1: model() }, rightSlot: 'checks' })
    const finding = rightSlot().getByRole('button', {
      name: /"Consultancy Fee" looks like a defined term/,
    })
    fireEvent.click(finding)
    expect(bodyField().value).toBe('The "Consultancy Fee" is payable monthly.')
  })

  it('lists comment threads in the Comments tab and resolves one', () => {
    const resolveComment = vi.fn()
    const comment: DocumentComment = {
      id: 'cmt_1',
      documentId: 'doc_1',
      anchorVersionId: 'ver_1',
      anchor: { paragraphId: 'p1', startOffset: 0, endOffset: 4 },
      body: 'Confirm the commencement date.',
      author: { id: 'usr_1', name: 'Lex' },
      resolvedAt: null,
      resolvedBy: null,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
      replies: [],
      anchorResolved: true,
    }
    mountWorkspace({
      models: { doc_1: model() },
      comments: { comments: [comment] },
      resolveComment,
      rightSlot: 'comments',
    })
    expect(rightSlot().getByText('Confirm the commencement date.')).toBeTruthy()
    fireEvent.click(rightSlot().getByRole('button', { name: 'Resolve' }))
    expect(resolveComment).toHaveBeenCalledWith('cmt_1')
  })
})
