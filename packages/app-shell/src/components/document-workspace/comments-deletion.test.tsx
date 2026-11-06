import '@obiter/test-dom'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { expect, it, mock } from 'bun:test'
import { DocumentCommentsPanel } from './comments-panel'
const comment = {
  id: 'c1',
  documentId: 'd1',
  anchorVersionId: 'v1',
  anchor: { paragraphId: 'p1', startOffset: 0, endOffset: 1 },
  body: 'Synthetic review note',
  author: { id: 'u1', name: 'Reviewer' },
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T10:00:00Z',
  replies: [],
  anchorResolved: true,
}
const props = {
  comments: [comment],
  importedComments: [],
  orphanedReplies: [],
  commentTarget: null,
  canEdit: true,
  currentUserId: 'u1',
  canModerate: true,
  pending: false,
  error: null,
  onCreate: async () => true,
  onReply: async () => true,
  onResolve: () => {},
  onReopen: () => {},
  onRevealAnchor: () => {},
}
it('hides Delete without an API deletion grant even for a moderator', () => {
  render(<DocumentCommentsPanel {...props} />)
  expect(screen.queryByRole('button', { name: 'Delete thread' })).toBeNull()
})
it('explains thread deletion and recovery before confirmation', () => {
  const onDelete = mock(() => {})
  render(
    <DocumentCommentsPanel
      {...props}
      deletableCommentIds={['c1']}
      onDelete={onDelete}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete thread' }))
  expect(
    screen.getByText(/You can restore it from Deleted comments/),
  ).toBeTruthy()
  expect(onDelete).not.toHaveBeenCalled()
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete thread',
    }),
  )
  expect(onDelete).toHaveBeenCalledWith('c1')
})
it('shows retained deleted comments and restores the chosen thread', () => {
  const onRestore = mock(() => {})
  render(
    <DocumentCommentsPanel
      {...props}
      comments={[]}
      deletedComments={[
        {
          id: 'c1',
          body: 'Retained note',
          authorName: 'Reviewer',
          deletedAt: '2026-11-05T10:00:00Z',
          isReply: false,
        },
      ]}
      onRestore={onRestore}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Deleted comments' }))
  expect(screen.getByText('Retained note')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Restore thread' }))
  expect(onRestore).toHaveBeenCalledWith('c1')
})
