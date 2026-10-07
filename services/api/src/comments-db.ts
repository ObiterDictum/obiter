import type { Pool, PoolClient } from 'pg'
import {
  documentCommentRecordSchema,
  type DocumentCommentAnchor,
  type DocumentCommentRecord,
  type UserRole,
} from '@obiter/contracts'
import { appendAuditLog } from './database'
import { lockMatterForEdit } from './matter-lock'

type CommentRow = {
  id: string
  document_id: string
  anchor_version_id: string | null
  paragraph_id: string
  end_paragraph_id: string | null
  start_offset: number
  end_offset: number
  body: string
  author_id: string
  author_name: string
  resolved_at: Date | string | null
  resolved_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

type ListedCommentRow = Partial<CommentRow> & {
  active_document_id: string
}

type ReplyRow = {
  id: string
  comment_id: string | null
  imported_comment_id: string | null
  body: string
  author_id: string
  author_name: string
  created_at: Date | string
}

/**
 * A stored product-authored reply. Exactly one of `commentId` (a product
 * thread head) and `importedCommentId` (a package-carried `ooxml-<w:id>`
 * thread head) is set; replies to an imported thread keep working when the
 * version's comments part changes, and surface as orphaned when it does not.
 */
export type DocumentCommentReplyRecord = {
  id: string
  commentId: string | null
  importedCommentId: string | null
  body: string
  author: { id: string; name: string }
  createdAt: string
}

export type ListedDocumentComments = {
  comments: DocumentCommentRecord[]
  replies: DocumentCommentReplyRecord[]
}

export type CreateCommentResult = {
  comment: DocumentCommentRecord
  /** True when a retry with the same client key returned the stored row. */
  replayed: boolean
}

export type CreateReplyResult = {
  reply: DocumentCommentReplyRecord
  replayed: boolean
}

/**
 * A resolution transition: 'applied' changed the stored state, 'unchanged'
 * means the comment already held the requested state for an authorised
 * caller, and 'forbidden' means the comment exists in scope but the actor is
 * neither its author nor an organisation manager.
 */
export type ResolutionResult =
  | { status: 'applied' | 'unchanged'; comment: DocumentCommentRecord }
  | { status: 'forbidden' }
  | { status: 'not_found' }

export class CommentsDatabaseError extends Error {
  constructor() {
    super('The comment operation could not be completed.')
    this.name = new.target.name
  }
}

export async function listDocumentComments(
  pool: Pool,
  input: { organisationId: string; matterId: string; documentId: string },
): Promise<ListedDocumentComments | null> {
  try {
    const result = await pool.query<ListedCommentRow>(
      `
        select
          document.id as active_document_id,
          comment.id, comment.document_id, comment.anchor_version_id,
          comment.paragraph_id, comment.end_paragraph_id,
          comment.start_offset, comment.end_offset,
          comment.body, comment.author_id, comment.author_name,
          comment.resolved_at, comment.resolved_by,
          comment.created_at, comment.updated_at
        from matter_documents document
        left join document_comments comment
          on comment.document_id = document.id
          and comment.matter_id = document.matter_id
          and comment.organisation_id = document.organisation_id
        where document.id = $1
          and document.matter_id = $2
          and document.organisation_id = $3
          and document.deleted_at is null
        order by comment.created_at, comment.id
      `,
      [input.documentId, input.matterId, input.organisationId],
    )
    if (result.rows.length === 0) return null

    const replies = await pool.query<ReplyRow>(
      `
        select ${replyColumns}
        from document_comment_replies
        where document_id = $1
          and matter_id = $2
          and organisation_id = $3
        order by created_at, id
      `,
      [input.documentId, input.matterId, input.organisationId],
    )

    return {
      comments: result.rows.flatMap((row) =>
        row.id ? [mapComment(requireCompleteRow(row))] : [],
      ),
      replies: replies.rows.map(mapReply),
    }
  } catch (error) {
    if (error instanceof CommentsDatabaseError) throw error
    throw new CommentsDatabaseError()
  }
}

export async function createDocumentComment(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    anchorVersionId: string
    anchor: DocumentCommentAnchor
    body: string
    authorId: string
    authorName: string
    clientKey?: string
    requestId: string
  },
): Promise<CreateCommentResult | null> {
  return commentTransaction(pool, async (client) => {
    // Matter before document, so a comment cannot commit on access that share
    // revocation removed while the request was queued.
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId: input.matterId,
        userId: input.authorId,
      }))
    ) {
      return null
    }
    if (!(await lockCurrentDocument(client, input))) return null

    const inserted = await client.query<CommentRow>(
      `
        insert into document_comments (
          organisation_id, matter_id, document_id, anchor_version_id,
          paragraph_id, end_paragraph_id, start_offset, end_offset, body,
          author_id, author_name, client_key, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
        on conflict (document_id, author_id, client_key)
          where client_key is not null
          do nothing
        returning ${commentColumns}
      `,
      [
        input.organisationId,
        input.matterId,
        input.documentId,
        input.anchorVersionId,
        input.anchor.paragraphId,
        crossParagraphEndId(input.anchor),
        input.anchor.startOffset,
        input.anchor.endOffset,
        input.body,
        input.authorId,
        input.authorName,
        input.clientKey ?? null,
      ],
    )
    const conflicted = inserted.rows[0] === undefined
    const row = conflicted
      ? (
          await client.query<CommentRow>(
            `
              select ${commentColumns}
              from document_comments
              where document_id = $1
                and author_id = $2
                and client_key = $3
            `,
            [input.documentId, input.authorId, input.clientKey ?? ''],
          )
        ).rows[0]
      : inserted.rows[0]
    if (!row) throw new CommentsDatabaseError()
    const comment = mapComment(row)
    if (conflicted) return { comment, replayed: true }

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.authorId,
      entityType: 'document_comment',
      entityId: comment.id,
      action: 'document.comment_create',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        anchorVersionId: input.anchorVersionId,
      },
      requestId: input.requestId,
    })
    return { comment, replayed: false }
  })
}

export async function createDocumentCommentReply(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    currentVersionId: string
    /** Product thread head; mutually exclusive with importedCommentId. */
    commentId?: string
    /** Imported `ooxml-<w:id>` thread head the route resolved in the model. */
    importedCommentId?: string
    body: string
    authorId: string
    authorName: string
    clientKey?: string
    requestId: string
  },
): Promise<CreateReplyResult | null> {
  if (
    (input.commentId === undefined) ===
    (input.importedCommentId === undefined)
  ) {
    throw new CommentsDatabaseError()
  }
  return commentTransaction(pool, async (client) => {
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId: input.matterId,
        userId: input.authorId,
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
    if (input.commentId !== undefined) {
      // The scoped composite foreign key covers row integrity; the explicit
      // probe keeps a missing or cross-scope parent a clean null rather than
      // a constraint violation.
      const parent = await client.query(
        `
          select id
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
      if (parent.rows.length === 0) return null
    }

    const inserted = await client.query<ReplyRow>(
      `
        insert into document_comment_replies (
          organisation_id, matter_id, document_id,
          comment_id, imported_comment_id,
          body, author_id, author_name, client_key, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        on conflict (document_id, author_id, client_key)
          where client_key is not null
          do nothing
        returning ${replyColumns}
      `,
      [
        input.organisationId,
        input.matterId,
        input.documentId,
        input.commentId ?? null,
        input.importedCommentId ?? null,
        input.body,
        input.authorId,
        input.authorName,
        input.clientKey ?? null,
      ],
    )
    const conflicted = inserted.rows[0] === undefined
    const row = conflicted
      ? (
          await client.query<ReplyRow>(
            `
              select ${replyColumns}
              from document_comment_replies
              where document_id = $1
                and author_id = $2
                and client_key = $3
            `,
            [input.documentId, input.authorId, input.clientKey ?? ''],
          )
        ).rows[0]
      : inserted.rows[0]
    if (!row) throw new CommentsDatabaseError()
    const reply = mapReply(row)
    if (conflicted) return { reply, replayed: true }

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.authorId,
      entityType: 'document_comment',
      entityId: input.commentId ?? input.importedCommentId ?? reply.id,
      action: 'document.comment_reply',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        replyId: reply.id,
      },
      requestId: input.requestId,
    })
    return { reply, replayed: false }
  })
}

/**
 * Resolves or reopens a comment thread. The author-or-manager predicate is
 * inside the UPDATE itself, so a concurrent author change cannot be raced:
 * the row either transitions under the caller's authority or does not move.
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
    const row = updated.rows[0]
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
      return { status: 'unchanged' as const, comment: mapComment(existing) }
    }
    const comment = mapComment(row)

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
    return { status: 'applied' as const, comment }
  })
  return outcome ?? { status: 'not_found' }
}

const commentColumns = `
  id, document_id, anchor_version_id, paragraph_id, end_paragraph_id,
  start_offset, end_offset,
  body, author_id, author_name, resolved_at, resolved_by, created_at, updated_at
`

const replyColumns = `
  id, comment_id, imported_comment_id, body, author_id, author_name, created_at
`

async function lockCurrentDocument(
  client: PoolClient,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    anchorVersionId: string
  },
) {
  const result = await client.query<{ id: string }>(
    `
      select document.id
      from matter_documents document
      join document_versions version
        on version.id = document.current_version_id
        and version.matter_document_id = document.id
        and version.matter_id = document.matter_id
        and version.organisation_id = document.organisation_id
      where document.id = $1
        and document.matter_id = $2
        and document.organisation_id = $3
        and document.current_version_id = $4
        and document.deleted_at is null
        and version.document_status = 'ready'
        and version.file_type = 'docx'
      for update of document
    `,
    [
      input.documentId,
      input.matterId,
      input.organisationId,
      input.anchorVersionId,
    ],
  )
  return result.rows.length === 1
}

async function commentTransaction<Result>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<Result>,
) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await operation(client)
    if (result === null) {
      await client.query('rollback')
      return result
    }
    await client.query('commit')
    return result
  } catch {
    await client.query('rollback')
    throw new CommentsDatabaseError()
  } finally {
    client.release()
  }
}

function crossParagraphEndId(anchor: DocumentCommentAnchor) {
  return anchor.endParagraphId !== undefined &&
    anchor.endParagraphId !== anchor.paragraphId
    ? anchor.endParagraphId
    : null
}

function mapComment(row: CommentRow): DocumentCommentRecord {
  return documentCommentRecordSchema.parse({
    id: row.id,
    documentId: row.document_id,
    anchorVersionId: row.anchor_version_id,
    anchor: {
      paragraphId: row.paragraph_id,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      ...(row.end_paragraph_id !== null
        ? { endParagraphId: row.end_paragraph_id }
        : {}),
    },
    body: row.body,
    author: { id: row.author_id, name: row.author_name },
    resolvedAt: timestamp(row.resolved_at),
    resolvedBy: row.resolved_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

function mapReply(row: ReplyRow): DocumentCommentReplyRecord {
  return {
    id: row.id,
    commentId: row.comment_id,
    importedCommentId: row.imported_comment_id,
    body: row.body,
    author: { id: row.author_id, name: row.author_name },
    createdAt: timestamp(row.created_at),
  }
}

function timestamp(value: Date | string): string
function timestamp(value: Date | string | null): string | null
function timestamp(value: Date | string | null) {
  return value instanceof Date ? value.toISOString() : value
}

function requireCompleteRow(row: ListedCommentRow): CommentRow {
  if (
    !row.id ||
    !row.document_id ||
    row.anchor_version_id === undefined ||
    !row.paragraph_id ||
    row.end_paragraph_id === undefined ||
    row.start_offset === undefined ||
    row.end_offset === undefined ||
    row.body === undefined ||
    !row.author_id ||
    !row.author_name ||
    row.resolved_at === undefined ||
    row.resolved_by === undefined ||
    row.created_at === undefined ||
    row.updated_at === undefined
  ) {
    throw new CommentsDatabaseError()
  }
  return {
    id: row.id,
    document_id: row.document_id,
    anchor_version_id: row.anchor_version_id,
    paragraph_id: row.paragraph_id,
    end_paragraph_id: row.end_paragraph_id,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    body: row.body,
    author_id: row.author_id,
    author_name: row.author_name,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
