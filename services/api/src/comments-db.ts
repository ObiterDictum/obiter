import type { Pool, PoolClient } from 'pg'
import {
  documentCommentSchema,
  type DocumentComment,
  type DocumentCommentAnchor,
} from '@obiter/contracts'
import { appendAuditLog } from './database'

type CommentRow = {
  id: string
  document_id: string
  anchor_version_id: string | null
  paragraph_id: string
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

export class CommentsDatabaseError extends Error {
  constructor() {
    super('The comment operation could not be completed.')
    this.name = new.target.name
  }
}

export async function listDocumentComments(
  pool: Pool,
  input: { organisationId: string; matterId: string; documentId: string },
): Promise<DocumentComment[] | null> {
  try {
    const result = await pool.query<ListedCommentRow>(
      `
        select
          document.id as active_document_id,
          comment.id, comment.document_id, comment.anchor_version_id,
          comment.paragraph_id, comment.start_offset, comment.end_offset,
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
    return result.rows.flatMap((row) =>
      row.id ? [mapComment(requireCompleteRow(row))] : [],
    )
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
    requestId: string
  },
): Promise<DocumentComment | null> {
  return commentTransaction(pool, async (client) => {
    if (!(await lockCurrentDocument(client, input))) return null

    const inserted = await client.query<CommentRow>(
      `
        insert into document_comments (
          organisation_id, matter_id, document_id, anchor_version_id,
          paragraph_id, start_offset, end_offset, body,
          author_id, author_name, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
        returning ${commentColumns}
      `,
      [
        input.organisationId,
        input.matterId,
        input.documentId,
        input.anchorVersionId,
        input.anchor.paragraphId,
        input.anchor.startOffset,
        input.anchor.endOffset,
        input.body,
        input.authorId,
        input.authorName,
      ],
    )
    const row = inserted.rows[0]
    if (!row) throw new CommentsDatabaseError()
    const comment = mapComment(row)

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
    return comment
  })
}

export async function resolveDocumentComment(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    currentVersionId: string
    commentId: string
    resolvedBy: string
    requestId: string
  },
): Promise<DocumentComment | null> {
  return commentTransaction(pool, async (client) => {
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
        set resolved_at = coalesce(resolved_at, now()),
          resolved_by = coalesce(resolved_by, $5),
          updated_at = case when resolved_at is null then now() else updated_at end
        where id = $1
          and document_id = $2
          and matter_id = $3
          and organisation_id = $4
        returning ${commentColumns}
      `,
      [
        input.commentId,
        input.documentId,
        input.matterId,
        input.organisationId,
        input.resolvedBy,
      ],
    )
    const row = updated.rows[0]
    if (!row) return null
    const comment = mapComment(row)

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.resolvedBy,
      entityType: 'document_comment',
      entityId: comment.id,
      action: 'document.comment_resolve',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        resolved: true,
      },
      requestId: input.requestId,
    })
    return comment
  })
}

const commentColumns = `
  id, document_id, anchor_version_id, paragraph_id, start_offset, end_offset,
  body, author_id, author_name, resolved_at, resolved_by, created_at, updated_at
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

function mapComment(row: CommentRow) {
  return documentCommentSchema.parse({
    id: row.id,
    documentId: row.document_id,
    anchorVersionId: row.anchor_version_id,
    anchor: {
      paragraphId: row.paragraph_id,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
    },
    body: row.body,
    author: { id: row.author_id, name: row.author_name },
    resolvedAt: timestamp(row.resolved_at),
    resolvedBy: row.resolved_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
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
