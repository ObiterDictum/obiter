import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import { OoxmlError, validateCommentAnchor } from '@obiter/ooxml'
import {
  documentCommentCreateRequestSchema,
  documentCommentCreateResponseSchema,
  documentCommentListResponseSchema,
  documentCommentReopenRequestSchema,
  documentCommentReopenResponseSchema,
  documentCommentReplyCreateRequestSchema,
  documentCommentReplyCreateResponseSchema,
  documentCommentResolveRequestSchema,
  documentCommentResolveResponseSchema,
  documentCommentSchema,
  type ApiErrorResponse,
  type DocumentComment,
  type DocumentCommentAnchor,
  type DocumentCommentRecord,
  type DocumentCommentReply,
  type DocumentImportedCommentThread,
  type DocumentModelWire,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import type { DocumentCommentReplyRecord } from '../comments-db'
import { createDocumentComment } from '../comments-create'
import { listDocumentComments } from '../comments-list'
import { createDocumentCommentReply } from '../comments-replies'
import { setDocumentCommentResolution } from '../comments-resolution'
import { getDocumentModel } from '../document-model-store'
import {
  importedCommentFingerprint,
  importedParentMatches,
} from '../imported-comment-fingerprint'
import type { StorageService } from '../storage'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
} from './document-route-shared'

type RouteContext = Context<{ Variables: AuthzVariables }>

export function createCommentsRoutes(pool: Pool, storage: StorageService) {
  const routes = new Hono<{ Variables: AuthzVariables }>()

  routes.get('/api/documents/:id/comments', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'view',
    )
    if (resolved instanceof Response) return resolved

    const listed = await listDocumentComments(pool, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
    })
    if (!listed) return documentNotFound(c)
    const model = await getDocumentModel(storage, resolved.version)
    return c.json(
      documentCommentListResponseSchema.parse(
        commentListBody(model, listed.comments, listed.replies),
      ),
    )
  })

  routes.post('/api/documents/:id/comments', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'edit',
    )
    if (resolved instanceof Response) return resolved

    const request = documentCommentCreateRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) return validationFailed(c)
    const model = await getDocumentModel(storage, resolved.version)
    try {
      validateCommentAnchor(model, request.data.anchor)
    } catch (error) {
      if (
        error instanceof OoxmlError &&
        error.code === 'comment-anchor-unresolved'
      ) {
        return anchorUnresolved(c)
      }
      throw error
    }
    const authorName = resolved.user.name?.trim() || resolved.user.id

    const created = await createDocumentComment(pool, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
      anchorVersionId: resolved.version.id,
      anchor: request.data.anchor,
      body: request.data.body,
      authorId: resolved.user.id,
      authorName,
      ...(request.data.clientKey !== undefined
        ? { clientKey: request.data.clientKey }
        : {}),
      requestId: c.get('requestId'),
    })
    if (!created) return documentNotFound(c)
    if (created.status === 'conflict') return clientKeyConflict(c)
    const comment = servedComment(model, created.comment, [])
    return c.json(
      documentCommentCreateResponseSchema.parse({ comment }),
      created.status === 'replayed' ? 200 : 201,
    )
  })

  routes.post('/api/documents/:id/comments/:commentId/replies', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'edit',
    )
    if (resolved instanceof Response) return resolved

    const request = documentCommentReplyCreateRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) return validationFailed(c)
    const parent = c.req.param('commentId')
    const authorName = resolved.user.name?.trim() || resolved.user.id
    const base = {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
      currentVersionId: resolved.version.id,
      body: request.data.body,
      authorId: resolved.user.id,
      authorName,
      ...(request.data.clientKey !== undefined
        ? { clientKey: request.data.clientKey }
        : {}),
      requestId: c.get('requestId'),
    }

    let target:
      | { commentId: string }
      | { importedCommentId: string; importedParentFingerprint: string }
    if (parent.startsWith('ooxml-')) {
      const model = await getDocumentModel(storage, resolved.version)
      const byId = new Map(model.comments.map((entry) => [entry.id, entry]))
      const hit = byId.get(parent)
      const head = hit?.parentId ? byId.get(hit.parentId) : hit
      // An imported thread without the file's own numeric w:id has no stable
      // identity to key a reply to across reparses: refuse it the same way a
      // missing target is refused, without exposing which case occurred.
      if (!head || head.ooxmlId === null) return documentNotFound(c)
      target = {
        importedCommentId: head.id,
        importedParentFingerprint: importedCommentFingerprint(head),
      }
    } else {
      target = { commentId: parent }
    }

    const created = await createDocumentCommentReply(pool, {
      ...base,
      ...target,
    })
    if (!created) return documentNotFound(c)
    if (created.status === 'conflict') return clientKeyConflict(c)
    return c.json(
      documentCommentReplyCreateResponseSchema.parse({
        reply: wireReply(created.reply),
      }),
      created.status === 'replayed' ? 200 : 201,
    )
  })

  routes.patch('/api/documents/:id/comments/:commentId/resolve', async (c) =>
    transitionResolution(
      c,
      pool,
      storage,
      c.req.param('id'),
      c.req.param('commentId'),
      true,
    ),
  )
  routes.patch('/api/documents/:id/comments/:commentId/reopen', async (c) =>
    transitionResolution(
      c,
      pool,
      storage,
      c.req.param('id'),
      c.req.param('commentId'),
      false,
    ),
  )

  return routes
}

async function transitionResolution(
  c: RouteContext,
  pool: Pool,
  storage: StorageService,
  documentId: string,
  commentId: string,
  resolve: boolean,
) {
  const resolved = await resolveCurrentReadyDocumentVersion(
    c,
    pool,
    documentId,
    'docx',
    'edit',
  )
  if (resolved instanceof Response) return resolved

  const request = (
    resolve
      ? documentCommentResolveRequestSchema
      : documentCommentReopenRequestSchema
  ).safeParse(await c.req.json().catch(() => null))
  if (!request.success) return validationFailed(c)

  // The model is read before the transition commits and the replies are read
  // inside the transition transaction itself, so the response renders only
  // state captured before commit — never a post-commit re-read.
  const model = await getDocumentModel(storage, resolved.version)
  const outcome = await setDocumentCommentResolution(pool, {
    organisationId: resolved.user.organisationId,
    matterId: resolved.document.matterId,
    documentId: resolved.document.id,
    currentVersionId: resolved.version.id,
    commentId,
    resolve,
    actorId: resolved.user.id,
    actorRole: resolved.user.role,
    requestId: c.get('requestId'),
  })
  if (outcome.status === 'not_found') return documentNotFound(c)
  if (outcome.status === 'forbidden') return commentForbidden(c)

  const replies = outcome.replies.map(wireReply)
  const comment = servedComment(model, outcome.comment, replies)
  const body = { comment }
  return c.json(
    resolve
      ? documentCommentResolveResponseSchema.parse(body)
      : documentCommentReopenResponseSchema.parse(body),
  )
}

/**
 * The merged list the panel renders: product threads with their replies and
 * live `anchorResolved` honesty, the package's own comment threads (imported
 * children folded in as replies), and product replies whose imported thread
 * is no longer in this version so nothing silently disappears.
 */
function commentListBody(
  model: DocumentModelWire,
  comments: DocumentCommentRecord[],
  replies: DocumentCommentReplyRecord[],
) {
  const order = paragraphOrder(model)
  const byId = new Map(model.comments.map((entry) => [entry.id, entry]))
  const children = new Map<string, typeof model.comments>()
  const heads: DocumentModelWire['comments'][number][] = []
  for (const entry of model.comments) {
    if (entry.parentId && byId.has(entry.parentId)) {
      const list = children.get(entry.parentId)
      if (list) list.push(entry)
      else children.set(entry.parentId, [entry])
    } else {
      heads.push(entry)
    }
  }

  // A reply joins its imported thread only when this version's head matches
  // the identity the reply was written against; a `w:id` the file now uses
  // for a different thread leaves the reply orphaned instead of misattaching.
  const productReplies = new Map<string, DocumentCommentReply[]>()
  const importedReplies = new Map<string, DocumentCommentReply[]>()
  const orphanedReplies: DocumentCommentReply[] = []
  for (const record of replies) {
    const reply = wireReply(record)
    if (record.commentId !== null) {
      const list = productReplies.get(record.commentId)
      if (list) list.push(reply)
      else productReplies.set(record.commentId, [reply])
      continue
    }
    if (record.importedCommentId === null) continue
    const head = byId.get(record.importedCommentId)
    if (
      head === undefined ||
      !importedParentMatches(record.importedParentFingerprint, head)
    ) {
      orphanedReplies.push(reply)
      continue
    }
    const list = importedReplies.get(record.importedCommentId)
    if (list) list.push(reply)
    else importedReplies.set(record.importedCommentId, [reply])
  }

  const headOrder = (entry: DocumentModelWire['comments'][number]) =>
    entry.anchor === null
      ? { paragraph: Number.MAX_SAFE_INTEGER, offset: 0 }
      : {
          paragraph:
            order.get(entry.anchor.paragraphId) ?? Number.MAX_SAFE_INTEGER,
          offset: entry.anchor.startOffset,
        }

  const importedComments: DocumentImportedCommentThread[] = heads
    .sort((left, right) => {
      const a = headOrder(left)
      const b = headOrder(right)
      return a.paragraph - b.paragraph || a.offset - b.offset
    })
    .map((head) => {
      const threadReplies = [
        // Package-carried children come first: they predate every product
        // reply and stay in their own comments.xml order.
        ...(children.get(head.id) ?? []).map(importedReply),
        ...(importedReplies.get(head.id) ?? []),
      ]
      return { ...head, replies: threadReplies }
    })

  return {
    comments: comments.map((comment) =>
      servedComment(model, comment, productReplies.get(comment.id) ?? []),
    ),
    importedComments,
    orphanedReplies,
  }
}

function servedComment(
  model: DocumentModelWire,
  record: DocumentCommentRecord,
  replies: DocumentCommentReply[],
): DocumentComment {
  return documentCommentSchema.parse({
    ...record,
    replies,
    anchorResolved: anchorResolves(model, record.anchor),
  })
}

function wireReply(record: DocumentCommentReplyRecord): DocumentCommentReply {
  return {
    imported: false,
    id: record.id,
    body: record.body,
    author: record.author,
    createdAt: record.createdAt,
  }
}

function importedReply(
  entry: DocumentModelWire['comments'][number],
): DocumentCommentReply {
  return {
    imported: true,
    id: entry.id,
    body: entry.body,
    author: { name: entry.author },
    createdAt: entry.createdAt,
  }
}

function anchorResolves(
  model: DocumentModelWire,
  anchor: DocumentCommentAnchor,
) {
  try {
    validateCommentAnchor(model, anchor)
    return true
  } catch (error) {
    if (
      error instanceof OoxmlError &&
      error.code === 'comment-anchor-unresolved'
    ) {
      return false
    }
    throw error
  }
}

function paragraphOrder(model: DocumentModelWire) {
  const order = new Map<string, number>()
  let index = 0
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      order.set(paragraph.id, index)
      index += 1
    }
  }
  return order
}

function anchorUnresolved(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'comment_anchor_unresolved',
      message: 'The comment anchor does not resolve in this document version.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 400)
}

function clientKeyConflict(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'comment_client_key_conflict',
      message:
        'This key was already used for a different comment or reply. Resubmit with a new key.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 409)
}

function commentForbidden(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'forbidden',
      message:
        'Only the comment author or an organisation manager can change its resolution state.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 403)
}

function validationFailed(c: RouteContext) {
  const body: ApiErrorResponse = {
    error: {
      code: 'validation_failed',
      message: 'The comment request is invalid.',
      requestId: c.get('requestId'),
    },
  }
  return c.json(body, 400)
}
