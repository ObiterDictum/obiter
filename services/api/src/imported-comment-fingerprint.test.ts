import { describe, expect, it } from 'bun:test'
import type { DocumentImportedComment } from '@obiter/contracts'

import {
  importedCommentFingerprint,
  importedParentMatches,
} from './imported-comment-fingerprint'

function comment(
  overrides: Partial<DocumentImportedComment> = {},
): DocumentImportedComment {
  return {
    id: 'cmt_1',
    ooxmlId: 3,
    author: 'Alex Morgan',
    createdAt: '2026-02-01T10:00:00Z',
    body: 'Synthetic review note',
    bodyTruncated: false,
    paraId: 'para_1',
    anchor: { paragraphId: 'para_1', startOffset: 0, endOffset: 7 },
    resolved: false,
    parentId: null,
    ...overrides,
  }
}

describe('imported comment fingerprint', () => {
  it('treats a moved comment as the same thread', () => {
    const moved = comment({
      anchor: { paragraphId: 'para_2', startOffset: 4, endOffset: 11 },
    })

    expect(importedCommentFingerprint(moved)).toBe(
      importedCommentFingerprint(comment()),
    )
  })

  it('distinguishes an absent author from an empty one', () => {
    expect(importedCommentFingerprint(comment({ author: null }))).not.toBe(
      importedCommentFingerprint(comment({ author: '' })),
    )
  })

  it('orphans a reply whose stored fingerprint is absent', () => {
    expect(importedParentMatches(null, comment())).toBe(false)
  })
})
