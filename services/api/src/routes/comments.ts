import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Pool } from 'pg'
import {
  documentCommentCreateRequestSchema,
  documentCommentCreateResponseSchema,
  documentCommentListResponseSchema,
  documentCommentResolveRequestSchema,
  documentCommentResolveResponseSchema,
  type ApiErrorResponse,
} from '@obiter/contracts'
import type { AuthzVariables } from '../authz'
import {
  CommentsDatabaseError,
  createDocumentComment,
  listDocumentComments,
  resolveDocumentComment,
} from '../comments-db'
import {
  documentNotFound,
  resolveCurrentReadyDocumentVersion,
} from './document-route-shared'

type RouteContext = Context<{ Variables: AuthzVariables }>

export function createCommentsRoutes(pool: Pool) {
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

    const comments = await listDocumentComments(pool, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
    })
    if (!comments) return documentNotFound(c)
    return c.json(documentCommentListResponseSchema.parse({ comments }))
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
    const authorName = resolved.user.name?.trim()
    if (!authorName) throw new CommentsDatabaseError()

    const comment = await createDocumentComment(pool, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
      anchorVersionId: resolved.version.id,
      anchor: request.data.anchor,
      body: request.data.body,
      authorId: resolved.user.id,
      authorName,
      requestId: c.get('requestId'),
    })
    if (!comment) return documentNotFound(c)
    return c.json(documentCommentCreateResponseSchema.parse({ comment }), 201)
  })

  routes.patch('/api/documents/:id/comments/:commentId/resolve', async (c) => {
    const resolved = await resolveCurrentReadyDocumentVersion(
      c,
      pool,
      c.req.param('id'),
      'docx',
      'edit',
    )
    if (resolved instanceof Response) return resolved

    const request = documentCommentResolveRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    )
    if (!request.success) return validationFailed(c)

    const comment = await resolveDocumentComment(pool, {
      organisationId: resolved.user.organisationId,
      matterId: resolved.document.matterId,
      documentId: resolved.document.id,
      currentVersionId: resolved.version.id,
      commentId: c.req.param('commentId'),
      resolvedBy: resolved.user.id,
      requestId: c.get('requestId'),
    })
    if (!comment) return documentNotFound(c)
    return c.json(documentCommentResolveResponseSchema.parse({ comment }))
  })

  return routes
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
