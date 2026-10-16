import type { Pool, PoolClient } from 'pg'
import type { UserRole } from '@obiter/contracts'
import {
  commentColumns,
  commentTransaction,
  type CommentRow,
  lockCurrentDocument,
  mapComment,
  mapReply,
  replyColumns,
  type ResolutionResult,
  type ReplyRow,
} from './comments-db'
import { appendAuditLog } from './database'
import { lockMatterForEdit } from './matter-lock'

/**
 * Resolves or reopens a comment thread. The author-or-manager predicate is
 * inside the UPDATE itself, so a concurrent author change cannot be raced:
 * the row either transitions under the caller's authority or does not move.
 * The thread's replies are read inside the transaction before commit, so the
 * response renders the committed state rather than a post-commit re-read.
 */
export async function setDocumentCommentResolution(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    currentVersionId: string
    commentId: string
    resolve: boolean
    actorId: string
    actorRole: UserRole
    requestId: string
  },
): Promise<ResolutionResult> {
  const canManage = input.actorRole === 'owner' || input.actorRole === 'admin'
  const outcome = await commentTransaction(pool, async (client) => {
    // Matter before document, matching comment create and the revocation lock.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId: input.matterId,
        userId: input.actorId,
      }))
    ) {
      return null
    }
    if (
      !(await lockCurrentDocument(client, {
        ...input,
        anchorVersionId: input.currentVersionId,
      }))
    ) {
      return null
    }

    const updated = await client.query<CommentRow>(
      `
        update document_comments
        set resolved_at = ${input.resolve ? 'now()' : 'null'},
          resolved_by = ${input.resolve ? '$5' : 'null'},
          updated_at = now()
        where id = $1
          and document_id = $2
          and matter_id = $3
          and organisation_id = $4
          and resolved_at is ${input.resolve ? 'null' : 'not null'}
          and (author_id = $5 or $6::boolean)
        returning ${commentColumns}
      `,
      [
        input.commentId,
        input.documentId,
        input.matterId,
        input.organisationId,
        input.actorId,
        canManage,
      ],
    )
    let row = updated.rows[0]
    let applied = true
    if (!row) {
      // The update missed: distinguish a comment that does not exist in scope
      // from one the actor may not transition, and from one already holding
      // the requested state.
      const probe = await client.query<CommentRow>(
        `
          select ${commentColumns}
          from document_comments
          where id = $1
            and document_id = $2
            and matter_id = $3
            and organisation_id = $4
        `,
        [
          input.commentId,
          input.documentId,
          input.matterId,
          input.organisationId,
        ],
      )
      const existing = probe.rows[0]
      if (!existing) return { status: 'not_found' as const }
      if (existing.author_id !== input.actorId && !canManage) {
        return { status: 'forbidden' as const }
      }
      row = existing
      applied = false
    }
    const replies = await threadReplies(client, input)
    const comment = mapComment(row)

    if (!applied) {
      return { status: 'unchanged' as const, comment, replies }
    }
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.actorId,
      entityType: 'document_comment',
      entityId: comment.id,
      action: input.resolve
        ? 'document.comment_resolve'
        : 'document.comment_reopen',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        resolved: input.resolve,
      },
      requestId: input.requestId,
    })
    return { status: 'applied' as const, comment, replies }
  })
  return outcome ?? { status: 'not_found' }
}

async function threadReplies(
  client: PoolClient,
  input: {
    commentId: string
    documentId: string
    matterId: string
    organisationId: string
  },
) {
  const result = await client.query<ReplyRow>(
    `
      select ${replyColumns}
      from document_comment_replies
      where comment_id = $1
        and document_id = $2
        and matter_id = $3
        and organisation_id = $4
      order by created_at, id
    `,
    [input.commentId, input.documentId, input.matterId, input.organisationId],
  )
  return result.rows.map(mapReply)
}
