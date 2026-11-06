import '@obiter/test-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentComment } from '@obiter/contracts'
import { openRibbonTab } from './editor-test-commands'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const apiModule = { ...(await import('../../api')) }
mock.module('../../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const { mountWorkspace, multiParagraphModel, paragraph } =
  await import('./docx-workspace-harness')

const model = () =>
  multiParagraphModel([paragraph('p1', 'Alpha'), paragraph('p2', 'Bravo')])

function productComment(overrides: Partial<DocumentComment> = {}) {
  const comment: DocumentComment = {
    id: 'cmt_1',
    documentId: 'doc_1',
    anchorVersionId: 'ver_1',
    anchor: { paragraphId: 'p1', startOffset: 1, endOffset: 4 },
    body: 'Check this wording',
    author: { id: 'usr_1', name: 'Lex' },
    resolvedAt: null,
    resolvedBy: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    replies: [],
    anchorResolved: true,
  }
  return { ...comment, ...overrides }
}

describe('right-panel Comments opened via Review', () => {
  it('deletes a granted thread and restores a deleted one', async () => {
    api.apiFetch.mockImplementation((url: string) =>
      url.includes('/comments/')
        ? Promise.resolve({})
        : Promise.reject(new Error('offline')),
    )
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        comments: [productComment()],
        deletableCommentIds: ['cmt_1'],
        deletedComments: [
          {
            id: 'cmt_9',
            body: 'Retired note',
            authorName: 'Lex',
            deletedAt: '2026-11-04T10:00:00Z',
            isReply: false,
          },
        ],
      },
    })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: /^Comments/ }))

    const panel = screen.getByRole('complementary', { name: 'Right slot' })
    expect(panel.getAttribute('data-tab')).toBe('comments')
    expect(document.querySelector('[data-docked-panel]')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'More actions' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete thread' }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete thread',
      }),
    )
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith(
        '/api/documents/doc_1/comments/cmt_1/delete',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deleted comments' }))
    expect(screen.getByText('Retired note')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore thread' }))
    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith(
        '/api/documents/doc_1/comments/cmt_9/restore',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
  })
})
