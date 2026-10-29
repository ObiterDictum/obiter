import type { DocumentComment, DocumentCommentReply } from '@obiter/contracts'

import type { AllocatedComment, AllocatedReply } from './comment-anchors'
import {
  extendedEntryXml,
  highestForeignCommentId,
  commentParaIds,
  paraIdAllocator,
  productCommentXml,
  type ExtendedCommentEntry,
} from './comments-package-emit'
import {
  COMMENTS_EXTENDED_PART,
  commentExportError,
  commentsRoot,
  ensureCommentsContentType,
  ensureCommentsExtendedPart,
  ensureCommentsPart,
  ensureCommentsRelationship,
  ensureContentTypeOverride,
  ensureDocumentRelationship,
  insertRootChild,
  requiredRoot,
  resolveCommentsPartName,
  resolveTypedPartName,
  WORD_2012_NAMESPACE,
} from './comments-package-parts'
import type { OoxmlDocument } from './model'
import { parseXmlElements } from './parts/overlay'

export type { ExtendedCommentEntry } from './comments-package-emit'

const COMMENTS_EXTENDED_RELATIONSHIP =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const COMMENTS_EXTENDED_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'

export type ProductReply = Extract<DocumentCommentReply, { imported: false }>

export type ImportedThreadReply = {
  ooxmlId: number | null
  paraId: string | null
  reply: ProductReply
}

export type AllocatedImportedReply = {
  ooxmlId: number
  paraId: string | null
  parentParaId: string | null
  reply: ProductReply
}

export function prepareCommentsPackage(
  document: OoxmlDocument,
  comments: readonly DocumentComment[],
  importedReplies: readonly ImportedThreadReply[] = [],
) {
  const emittedIds = new Set<string>()
  for (const comment of comments) {
    if (emittedIds.has(comment.id)) throw commentExportError()
    emittedIds.add(comment.id)
    for (const reply of comment.replies) {
      if (reply.imported || emittedIds.has(reply.id)) throw commentExportError()
      emittedIds.add(reply.id)
    }
  }
  for (const { reply } of importedReplies) {
    if (reply.imported || emittedIds.has(reply.id)) throw commentExportError()
    emittedIds.add(reply.id)
  }

  const partName = resolveCommentsPartName(document)
  const part = ensureCommentsPart(document, partName)
  ensureCommentsRelationship(document, partName)
  ensureCommentsContentType(document, partName)
  const firstId = highestForeignCommentId(part) + 1
  const emissionCount =
    comments.length +
    comments.reduce((count, comment) => count + comment.replies.length, 0) +
    importedReplies.length
  if (firstId + emissionCount - 1 > 2_147_483_647) throw commentExportError()
  const nextParaId = paraIdAllocator(commentParaIds(part))

  let nextId = firstId
  const allocated = [...comments]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map((comment) => {
      const productReplies = comment.replies.filter(
        (reply): reply is ProductReply => !reply.imported,
      )
      const allocatedComment: AllocatedComment = {
        comment,
        ooxmlId: nextId,
        paraId:
          comment.resolvedAt !== null || productReplies.length > 0
            ? nextParaId()
            : null,
        replies: [],
      }
      nextId += 1
      allocatedComment.replies = [...productReplies]
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .map((reply) => {
          const allocatedReply: AllocatedReply = {
            reply,
            ooxmlId: nextId,
            paraId: nextParaId(),
          }
          nextId += 1
          return allocatedReply
        })
      return allocatedComment
    })

  const allocatedImportedReplies: AllocatedImportedReply[] = [
    ...importedReplies,
  ]
    .sort(
      (left, right) =>
        (left.ooxmlId ?? Number.MAX_SAFE_INTEGER) -
          (right.ooxmlId ?? Number.MAX_SAFE_INTEGER) ||
        (left.reply.id < right.reply.id
          ? -1
          : left.reply.id > right.reply.id
            ? 1
            : 0),
    )
    .map(({ paraId, reply }) => {
      const allocatedReply: AllocatedImportedReply = {
        reply,
        ooxmlId: nextId,
        paraId: paraId === null ? null : nextParaId(),
        parentParaId: paraId,
      }
      nextId += 1
      return allocatedReply
    })
  return { partName, allocated, importedReplies: allocatedImportedReplies }
}

export function appendProductComments(
  document: OoxmlDocument,
  partName: string,
  comments: readonly AllocatedComment[],
  importedReplies: readonly AllocatedImportedReply[],
): ExtendedCommentEntry[] {
  const part = document.sourceParts.get(partName)
  if (!part?.overlay || part.kind !== 'xml') throw commentExportError()
  const overlay = part.overlay
  const root = commentsRoot(overlay.source)

  const fragments: string[] = []
  const extended: ExtendedCommentEntry[] = []
  for (const { comment, ooxmlId, paraId, replies } of comments) {
    fragments.push(
      productCommentXml({
        ooxmlId,
        author: comment.author.name,
        createdAt: comment.createdAt,
        body: comment.body,
        paraId,
      }),
    )
    if (comment.resolvedAt !== null && paraId !== null) {
      extended.push({ paraId, done: true })
    }
    for (const reply of replies) {
      fragments.push(
        productCommentXml({
          ooxmlId: reply.ooxmlId,
          author: reply.reply.author.name,
          createdAt: reply.reply.createdAt,
          body: reply.reply.body,
          paraId: reply.paraId,
        }),
      )
      if (paraId !== null && reply.paraId !== null) {
        extended.push({ paraId: reply.paraId, parentParaId: paraId })
      }
    }
  }
  for (const { ooxmlId, paraId, parentParaId, reply } of importedReplies) {
    fragments.push(
      productCommentXml({
        ooxmlId,
        author: reply.author.name,
        createdAt: reply.createdAt,
        body: reply.body,
        paraId,
      }),
    )
    if (paraId !== null && parentParaId !== null) {
      extended.push({ paraId, parentParaId })
    }
  }

  insertRootChild(part, overlay, 'product-comments', root, fragments.join(''))
  return extended
}

export function appendCommentsExtended(
  document: OoxmlDocument,
  entries: readonly ExtendedCommentEntry[],
) {
  if (entries.length === 0) return
  const partName = resolveTypedPartName(
    document,
    'commentsExtended',
    COMMENTS_EXTENDED_PART,
  )
  const part = ensureCommentsExtendedPart(document, partName)
  ensureDocumentRelationship(document, partName, COMMENTS_EXTENDED_RELATIONSHIP)
  ensureContentTypeOverride(document, partName, COMMENTS_EXTENDED_CONTENT_TYPE)
  const overlay = part.overlay
  if (!overlay) throw commentExportError()
  const root = requiredRoot(
    parseXmlElements(overlay.source),
    WORD_2012_NAMESPACE,
    'commentsEx',
  )
  insertRootChild(
    part,
    overlay,
    'product-comments-extended',
    root,
    entries.map(extendedEntryXml).join(''),
  )
}
