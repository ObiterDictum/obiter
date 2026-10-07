import '@obiter/test-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { ApiError } from '../../api'
import type {
  DocumentComment,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  placeCaret,
  selectionStatus,
} from './paragraph-selection-harness'

const model = () =>
  multiParagraphModel([
    paragraph('p1', 'Alpha'),
    paragraph('p2', 'Bravo'),
    paragraph('p3', 'Charlie'),
  ])

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

function importedThread(
  overrides: Partial<DocumentImportedCommentThread> = {},
) {
  const thread: DocumentImportedCommentThread = {
    id: 'ooxml-3',
    ooxmlId: 3,
    author: 'Reviewer A',
    createdAt: '2024-01-02T00:00:00Z',
    body: 'Imported margin note',
    bodyTruncated: false,
    paraId: 'PARA0003',
    anchor: { paragraphId: 'p2', startOffset: 0, endOffset: 5 },
    resolved: false,
    parentId: null,
    replies: [],
  }
  return { ...thread, ...overrides }
}

function openCommentsPanel() {
  openRibbonTab('Review')
  fireEvent.click(screen.getByRole('button', { name: /^Comments/ }))
}

function submitNewComment(body: string) {
  const input = screen.getByLabelText('New comment')
  fireEvent.change(input, { target: { value: body } })
  const form = input.closest('form')
  if (!form) throw new Error('comment form missing')
  fireEvent.submit(form)
}

function submitReply(body: string) {
  const input = screen.getByLabelText('Reply')
  fireEvent.change(input, { target: { value: body } })
  fireEvent.submit(input.closest('form') as HTMLFormElement)
}

function clientKeys(calls: unknown[][]) {
  return calls.map((call) => {
    const variables = call[0] as {
      clientKey?: string
      reply?: { clientKey?: string }
    }
    return variables.clientKey ?? variables.reply?.clientKey
  })
}

describe('comment anchors', () => {
  it('anchors a new comment to the selected text, not the paragraph', async () => {
    const createComment = vi.fn()
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    nativeSelect(1, 4)

    openCommentsPanel()
    submitNewComment('Tighten this')

    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    expect(createComment).toHaveBeenCalledWith({
      body: 'Tighten this',
      anchor: { paragraphId: 'p1', startOffset: 1, endOffset: 4 },
      clientKey: expect.any(String),
    })
  })

  it('anchors a bare caret as an insertion-point comment', async () => {
    const createComment = vi.fn()
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    nativeSelect(3, 3)

    openCommentsPanel()
    submitNewComment('Insert a clause here')

    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith({
        body: 'Insert a clause here',
        anchor: { paragraphId: 'p1', startOffset: 3, endOffset: 3 },
        clientKey: expect.any(String),
      }),
    )
  })

  it('anchors a selection spanning paragraphs with an end paragraph', async () => {
    const createComment = vi.fn()
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    placeCaret(5)
    fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })

    openCommentsPanel()
    submitNewComment('Spans two paragraphs')

    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith({
        body: 'Spans two paragraphs',
        anchor: {
          paragraphId: 'p1',
          startOffset: 5,
          endParagraphId: 'p2',
          endOffset: 1,
        },
        clientKey: expect.any(String),
      }),
    )
  })

  it('reuses the intent key only while its submit is unsatisfied', async () => {
    const createComment = vi
      .fn()
      .mockRejectedValueOnce(new Error('request aborted'))
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    nativeSelect(1, 4)

    openCommentsPanel()
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    // A failed submit keeps the draft so the same intent can be retried.
    const input = screen.getByLabelText('New comment')
    expect((input as HTMLInputElement).value).toBe('Tighten this')

    // Retrying the identical unsatisfied intent replays under the same key.
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))

    // Once stored, the intent is finished: the next identical submission is
    // a deliberate second comment under a fresh key, not a replay.
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(3))

    const keys = clientKeys(createComment.mock.calls)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('mints a new intent when the draft or anchor changes, without losing a pending one', async () => {
    const createComment = vi
      .fn()
      .mockRejectedValue(new Error('request aborted'))
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    nativeSelect(1, 4)

    openCommentsPanel()
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))

    // A changed body is a different intent and must not reuse the key.
    submitNewComment('Different wording')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(2))

    // A changed anchor is a different intent too: the pointer press that
    // collapses the live selection comes first, then the new drag.
    clickParagraph('p1')
    nativeSelect(0, 3)
    submitNewComment('Different wording')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(3))

    // Submitting the original unsatisfied intent again still replays its key.
    clickParagraph('p1')
    nativeSelect(1, 4)
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(4))

    const keys = clientKeys(createComment.mock.calls)
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    expect(keys[2]).not.toBe(keys[1])
    expect(keys[3]).toBe(keys[0])
  })

  it('does not alias a pending intent across documents', async () => {
    const createComment = vi
      .fn()
      .mockRejectedValue(new Error('request aborted'))
    const view = mountWorkspace({
      models: { doc_1: model(), doc_2: model() },
      createComment,
    })
    clickParagraph('p1')
    nativeSelect(1, 4)
    openCommentsPanel()
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))

    rerenderWorkspace(view, 'doc_2')
    clickParagraph('p1')
    nativeSelect(1, 4)
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(2))

    const keys = clientKeys(createComment.mock.calls)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('drops a conflicting intent so the next submit gets a fresh key', async () => {
    const createComment = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(
          'comment_client_key_conflict',
          'This key was already used for a different comment or reply.',
          409,
          'req_1',
        ),
      )
    mountWorkspace({ models: { doc_1: model() }, createComment })
    clickParagraph('p1')
    nativeSelect(1, 4)

    openCommentsPanel()
    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))

    submitNewComment('Tighten this')
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(2))

    const keys = clientKeys(createComment.mock.calls)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('refuses a create with no caret or selection in the document', () => {
    const createComment = vi.fn()
    mountWorkspace({ models: { doc_1: model() }, createComment })

    openCommentsPanel()
    const input = screen.getByLabelText('New comment')
    expect((input as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'Orphaned' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(createComment).not.toHaveBeenCalled()
  })
})

describe('comment cards', () => {
  it('shows a product comment and navigates back to its anchored range', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: { comments: [productComment()] },
    })
    openCommentsPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Show in document' }))

    expect(selectionStatus()).toMatch(/1 paragraph selected/)
    expect(document.querySelector('[data-selected-text]')?.textContent).toBe(
      'lph',
    )
  })

  it('keeps an unresolved anchor listed without a navigation action', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        comments: [productComment({ anchorResolved: false })],
      },
    })
    openCommentsPanel()

    expect(screen.getByText(/anchor no longer resolves/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Show in document' }),
    ).toBeNull()
  })

  it('posts a reply against the product comment', async () => {
    const replyComment = vi.fn()
    mountWorkspace({
      models: { doc_1: model() },
      comments: { comments: [productComment()] },
      replyComment,
    })
    openCommentsPanel()

    const input = screen.getByLabelText('Reply')
    fireEvent.change(input, { target: { value: 'Agreed' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(replyComment).toHaveBeenCalledWith({
        commentId: 'cmt_1',
        reply: { body: 'Agreed', clientKey: expect.any(String) },
      }),
    )
  })

  it('keeps a failed reply draft and replays it under the same key', async () => {
    const replyComment = vi
      .fn()
      .mockRejectedValueOnce(new Error('request aborted'))
    mountWorkspace({
      models: { doc_1: model() },
      comments: { comments: [productComment()] },
      replyComment,
    })
    openCommentsPanel()

    submitReply('Agreed')
    await waitFor(() => expect(replyComment).toHaveBeenCalledTimes(1))
    expect((screen.getByLabelText('Reply') as HTMLInputElement).value).toBe(
      'Agreed',
    )

    submitReply('Agreed')
    await waitFor(() => expect(replyComment).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect((screen.getByLabelText('Reply') as HTMLInputElement).value).toBe(
        '',
      ),
    )

    // The stored reply satisfied the intent: a further identical reply is a
    // new deliberate write under a new key.
    submitReply('Agreed')
    await waitFor(() => expect(replyComment).toHaveBeenCalledTimes(3))

    const keys = clientKeys(replyComment.mock.calls)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('shows replies already on the thread', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        comments: [
          productComment({
            replies: [
              {
                imported: false,
                id: 'rpl_1',
                body: 'Second opinion',
                author: { id: 'usr_2', name: 'Priya' },
                createdAt: '2024-01-03T00:00:00Z',
              },
            ],
          }),
        ],
      },
    })
    openCommentsPanel()

    expect(screen.getByText('Second opinion')).toBeTruthy()
    expect(screen.getByText('Priya')).toBeTruthy()
  })
})

describe('resolve and reopen', () => {
  it('lets the comment author resolve an open thread', () => {
    const resolveComment = vi.fn()
    mountWorkspace({
      models: { doc_1: model() },
      comments: { comments: [productComment()] },
      resolveComment,
    })
    openCommentsPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(resolveComment).toHaveBeenCalledWith('cmt_1')
  })

  it('hides resolve from a member on another member’s thread', () => {
    mountWorkspace({
      models: { doc_1: model() },
      user: { id: 'usr_2', role: 'member' },
      comments: {
        comments: [productComment({ author: { id: 'usr_9', name: 'Noor' } })],
      },
    })
    openCommentsPanel()

    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  })

  it('still shows resolve to a member on their own thread', () => {
    mountWorkspace({
      models: { doc_1: model() },
      user: { id: 'usr_1', role: 'member' },
      comments: { comments: [productComment()] },
    })
    openCommentsPanel()

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy()
  })

  it('reopens a resolved thread through the reopen action', () => {
    const reopenComment = vi.fn()
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        comments: [
          productComment({
            resolvedAt: '2024-01-05T00:00:00Z',
            resolvedBy: 'usr_1',
          }),
        ],
      },
      reopenComment,
    })
    openCommentsPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(reopenComment).toHaveBeenCalledWith('cmt_1')
  })
})

describe('imported comments', () => {
  it('lists a comment read from the file and navigates to its anchor', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: { importedComments: [importedThread()] },
    })
    openCommentsPanel()

    expect(screen.getByText('From the Word file')).toBeTruthy()
    expect(screen.getByText('Imported margin note')).toBeTruthy()
    expect(screen.getByText('Reviewer A')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show in document' }))
    expect(document.querySelector('[data-selected-text]')?.textContent).toBe(
      'Bravo',
    )
  })

  it('marks an imported thread resolved in the file without a reopen action', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        importedComments: [importedThread({ resolved: true })],
      },
    })
    openCommentsPanel()

    expect(screen.getByText(/resolved in file/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('replies to an imported thread under its ooxml identity', async () => {
    const replyComment = vi.fn()
    mountWorkspace({
      models: { doc_1: model() },
      comments: { importedComments: [importedThread()] },
      replyComment,
    })
    openCommentsPanel()

    const input = screen.getByLabelText('Reply')
    fireEvent.change(input, { target: { value: 'Reply in product' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(replyComment).toHaveBeenCalledWith({
        commentId: 'ooxml-3',
        reply: { body: 'Reply in product', clientKey: expect.any(String) },
      }),
    )
  })

  it('offers no reply on an anonymous imported comment', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        importedComments: [
          importedThread({ id: 'ooxml-anon-0', ooxmlId: null }),
        ],
      },
    })
    openCommentsPanel()

    expect(screen.getByText('Imported margin note')).toBeTruthy()
    expect(screen.queryByLabelText('Reply')).toBeNull()
  })

  it('surfaces replies whose imported thread left the file', () => {
    mountWorkspace({
      models: { doc_1: model() },
      comments: {
        orphanedReplies: [
          {
            imported: false,
            id: 'rpl_9',
            body: 'Reply whose thread is gone',
            author: { id: 'usr_1', name: 'Lex' },
            createdAt: '2024-01-04T00:00:00Z',
          },
        ],
      },
    })
    openCommentsPanel()

    expect(
      screen.getByText('Replies to comments no longer in this file'),
    ).toBeTruthy()
    expect(screen.getByText('Reply whose thread is gone')).toBeTruthy()
  })
})
