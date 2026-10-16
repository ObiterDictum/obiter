import { createHash } from 'node:crypto'
import type { DocumentImportedComment } from '@obiter/contracts'

/**
 * The identity a product reply was written against, hashed so a later
 * version whose `w:id` collides with — or whose thread content differs from —
 * the commented-on head cannot silently inherit that reply. Covers the
 * served identity fields; the anchor is excluded because a moved comment is
 * still the same thread, and `resolved`/`bodyTruncated` are state the file
 * owns rather than identity. `null` fields stay `null` in the digest input
 * so an absent author is distinct from an empty one.
 */
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

/**
 * Whether a stored reply may attach to this version's imported head. Replies
 * written before the fingerprint column existed carry null: no validated
 * identity was recorded for them, so they orphan like a mismatched head
 * rather than attaching on the `w:id` slot alone.
 */
export function importedParentMatches(
  storedFingerprint: string | null,
  head: DocumentImportedComment,
) {
  return (
    storedFingerprint !== null &&
    importedCommentFingerprint(head) === storedFingerprint
  )
}
