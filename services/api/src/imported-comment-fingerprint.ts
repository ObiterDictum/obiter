import { createHash } from 'node:crypto'
import type { DocumentImportedComment } from '@obiter/contracts'

export function importedCommentFingerprint(comment: DocumentImportedComment) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: comment.id,
        ooxmlId: comment.ooxmlId,
        author: comment.author,
        createdAt: comment.createdAt,
        paraId: comment.paraId,
        body: comment.body,
      }),
    )
    .digest('hex')
}

export function importedParentMatches(
  storedFingerprint: string | null,
  head: DocumentImportedComment,
) {
  return (
    storedFingerprint !== null &&
    importedCommentFingerprint(head) === storedFingerprint
  )
}
