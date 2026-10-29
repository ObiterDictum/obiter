import type { Pool, PoolClient } from 'pg'
import {
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions as SharedTestDatabaseOptions,
} from './document-route.test-support'
import {
  commentRow,
  replyRow,
  type StoredComment,
  type StoredReply,
} from './comments-rows.test-support'

interface TestDatabaseOptions extends SharedTestDatabaseOptions {
  auditFailure?: boolean
  transactionDocumentMissing?: boolean
}

export class TestDatabase extends SharedTestDatabase {
  comments = new Map<string, StoredComment>()
  replies = new Map<string, StoredReply>()
  audits: Array<{
    entityType: string
    entityId: string
    action: string
    metadata: Record<string, unknown>
  }> = []
  private nextComment = 1
  private nextReply = 1

  constructor(private readonly commentOptions: TestDatabaseOptions = {}) {
    super({ access: 'edit', ...commentOptions })
  }

  seedComment(overrides: Partial<StoredComment> = {}) {
    const value = this.storedComment(overrides)
    this.comments.set(value.id, value)
    return value
  }

  seedReply(overrides: Partial<StoredReply> = {}) {
    const value = this.storedReply(overrides)
    this.replies.set(value.id, value)
    return value
  }

  override pool() {
    const sharedPool = super.pool()
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes('from document_comment_replies')) {
          this.queries.push(sql)
          const [documentId, matterId, organisationId] = parameters as string[]
          const replies = [...this.replies.values()].filter(
            (reply) =>
              reply.documentId === documentId &&
              reply.matterId === matterId &&
              reply.organisationId === organisationId,
          )
          return { rows: replies.map(replyRow) }
        }
        if (!sql.includes('left join document_comments')) {
          return sharedPool.query(sql, parameters)
        }
        this.queries.push(sql)
        const [documentId, matterId, organisationId] = parameters as string[]
        if (
          documentId !== 'doc_1' ||
          matterId !== 'mtr_1' ||
          organisationId !== 'org_1'
        ) {
          return { rows: [] }
        }
        const comments = [...this.comments.values()].filter(
          (comment) =>
            comment.documentId === documentId &&
            comment.matterId === matterId &&
            comment.organisationId === organisationId,
        )
        return {
          rows:
            comments.length === 0
              ? [{ active_document_id: documentId }]
              : comments.map((comment) => ({
                  active_document_id: documentId,
                  ...commentRow(comment),
                })),
        }
      },
      connect: async () => this.client(await sharedPool.connect()),
    } as unknown as Pool
  }

  private client(sharedClient: PoolClient) {
    let stagedComments = new Map(this.comments)
    let stagedReplies = new Map(this.replies)
    let stagedAudits = [...this.audits]
    let matterLockChecked = false
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        const command = sql.trim()
        if (
          command === 'begin' ||
          command === 'commit' ||
          command === 'rollback'
        ) {
          this.transactionCommands.push(command)
          if (command === 'commit') {
            this.comments = stagedComments
            this.replies = stagedReplies
            this.audits = stagedAudits
          }
          return { rows: [] }
        }
        if (sql.includes('select id from matters')) {
          this.queries.push(sql)
          matterLockChecked = true
          return { rows: [{ id: 'mtr_1' }] }
        }
        if (sql.includes('select matter.id from matters matter')) {
          this.queries.push(sql)
          if (!matterLockChecked) {
            throw new Error(
              'The edit access re-check must follow the matter lock.',
            )
          }
          if (!sql.includes('matter_shares')) {
            throw new Error(
              'The edit access re-check must evaluate matter_shares.',
            )
          }
          const access = this.commentOptions.access ?? 'edit'
          return {
            rows:
              access === 'owner' || access === 'edit' ? [{ id: 'mtr_1' }] : [],
          }
        }
        if (sql.includes('from users') && sql.includes('for share')) {
          this.queries.push(sql)
          const access = this.commentOptions.access ?? 'edit'
          return {
            rows:
              access === 'owner' || access === 'edit'
                ? [{ id: String(parameters[0]) }]
                : [],
          }
        }
        if (sql.includes('join document_versions version')) {
          this.queries.push(sql)
          const [documentId, matterId, organisationId, versionId] =
            parameters as string[]
          return {
            rows:
              !this.commentOptions.transactionDocumentMissing &&
              documentId === 'doc_1' &&
              matterId === 'mtr_1' &&
              organisationId === 'org_1' &&
              versionId === 'ver_1' &&
              (this.commentOptions.status ?? 'ready') === 'ready' &&
              (this.commentOptions.fileType ?? 'docx') === 'docx'
                ? [{ id: documentId }]
                : [],
          }
        }
        if (
          sql.includes('from document_comments') &&
          sql.includes('client_key = $3')
        ) {
          this.queries.push(sql)
          const scoped = sql.includes('organisation_id = $4')
          const [documentId, authorId, clientKey, organisationId] =
            parameters as string[]
          const existing = [...stagedComments.values()].find(
            (comment) =>
              comment.documentId === documentId &&
              comment.authorId === authorId &&
              comment.clientKey === clientKey &&
              (!scoped || comment.organisationId === organisationId),
          )
          return { rows: existing ? [commentRow(existing)] : [] }
        }
        if (
          sql.includes('from document_comment_replies') &&
          sql.includes('client_key = $3')
        ) {
          this.queries.push(sql)
          const scoped = sql.includes('organisation_id = $4')
          const [documentId, authorId, clientKey, organisationId] =
            parameters as string[]
          const existing = [...stagedReplies.values()].find(
            (reply) =>
              reply.documentId === documentId &&
              reply.authorId === authorId &&
              reply.clientKey === clientKey &&
              (!scoped || reply.organisationId === organisationId),
          )
          return { rows: existing ? [replyRow(existing)] : [] }
        }
        if (
          sql.includes('from document_comment_replies') &&
          sql.includes('comment_id = $1')
        ) {
          this.queries.push(sql)
          const [commentId, documentId, matterId, organisationId] =
            parameters as string[]
          const replies = [...stagedReplies.values()].filter(
            (reply) =>
              reply.commentId === commentId &&
              reply.documentId === documentId &&
              reply.matterId === matterId &&
              reply.organisationId === organisationId,
          )
          return { rows: replies.map(replyRow) }
        }
        if (
          sql.includes('select id\n') &&
          sql.includes('from document_comments')
        ) {
          this.queries.push(sql)
          const [commentId, documentId, matterId, organisationId] =
            parameters as string[]
          const existing = stagedComments.get(commentId)
          return {
            rows:
              existing &&
              existing.documentId === documentId &&
              existing.matterId === matterId &&
              existing.organisationId === organisationId
                ? [{ id: commentId }]
                : [],
          }
        }
        if (
          sql.includes('from document_comments') &&
          sql.includes('where id = $1')
        ) {
          this.queries.push(sql)
          const [commentId, documentId, matterId, organisationId] =
            parameters as string[]
          const existing = stagedComments.get(commentId)
          return {
            rows:
              existing &&
              existing.documentId === documentId &&
              existing.matterId === matterId &&
              existing.organisationId === organisationId
                ? [commentRow(existing)]
                : [],
          }
        }
        if (sql.includes('insert into document_comments')) {
          this.queries.push(sql)
          const [
            organisationId,
            matterId,
            documentId,
            anchorVersionId,
            paragraphId,
            endParagraphId,
            startOffset,
            endOffset,
            body,
            authorId,
            authorName,
            clientKey,
          ] = parameters as [
            string,
            string,
            string,
            string,
            string,
            string | null,
            number,
            number,
            string,
            string,
            string,
            string | null,
          ]
          if (
            clientKey !== null &&
            [...stagedComments.values()].some(
              (comment) =>
                comment.documentId === documentId &&
                comment.authorId === authorId &&
                comment.clientKey === clientKey,
            )
          ) {
            return { rows: [] }
          }
          const value = this.storedComment({
            organisationId,
            matterId,
            documentId,
            anchorVersionId,
            paragraphId,
            endParagraphId,
            startOffset,
            endOffset,
            body,
            authorId,
            authorName,
            clientKey,
            createdAt: '2026-08-10T13:00:00.000Z',
            updatedAt: '2026-08-10T13:00:00.000Z',
          })
          stagedComments.set(value.id, value)
          return { rows: [commentRow(value)] }
        }
        if (sql.includes('insert into document_comment_replies')) {
          this.queries.push(sql)
          const [
            organisationId,
            matterId,
            documentId,
            commentId,
            importedCommentId,
            importedParentFingerprint,
            body,
            authorId,
            authorName,
            clientKey,
          ] = parameters as [
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            string,
            string,
            string,
            string | null,
          ]
          if (
            clientKey !== null &&
            [...stagedReplies.values()].some(
              (reply) =>
                reply.documentId === documentId &&
                reply.authorId === authorId &&
                reply.clientKey === clientKey,
            )
          ) {
            return { rows: [] }
          }
          const value = this.storedReply({
            organisationId,
            matterId,
            documentId,
            commentId,
            importedCommentId,
            importedParentFingerprint,
            body,
            authorId,
            authorName,
            clientKey,
            createdAt: '2026-08-10T13:30:00.000Z',
          })
          stagedReplies.set(value.id, value)
          return { rows: [replyRow(value)] }
        }
        if (sql.includes('update document_comments')) {
          this.queries.push(sql)
          const resolve = sql.includes('resolved_at = now()')
          const [
            commentId,
            documentId,
            matterId,
            organisationId,
            actorId,
            canManage,
          ] = parameters as [string, string, string, string, string, boolean]
          const existing = stagedComments.get(commentId)
          const inScope =
            existing &&
            existing.documentId === documentId &&
            existing.matterId === matterId &&
            existing.organisationId === organisationId
          const canTransition =
            inScope &&
            (existing.authorId === actorId || canManage === true) &&
            (resolve
              ? existing.resolvedAt === null
              : existing.resolvedAt !== null)
          if (!existing || !inScope || !canTransition) {
            return { rows: [] }
          }
          const transitioned: StoredComment = {
            ...existing,
            resolvedAt: resolve ? '2026-08-10T14:00:00.000Z' : null,
            resolvedBy: resolve ? actorId : null,
            updatedAt: '2026-08-10T14:00:00.000Z',
          }
          stagedComments.set(commentId, transitioned)
          return { rows: [commentRow(transitioned)] }
        }
        if (sql.includes('insert into audit_logs')) {
          this.queries.push(sql)
          if (this.commentOptions.auditFailure)
            throw new Error('audit insert failed')
          const [, , entityType, entityId, action, metadata] =
            parameters as string[]
          stagedAudits.push({
            entityType,
            entityId,
            action,
            metadata: JSON.parse(metadata) as Record<string, unknown>,
          })
          return { rows: [] }
        }
        return sharedClient.query(sql, parameters)
      },
      release: () => sharedClient.release(),
    }
  }

  private storedComment(overrides: Partial<StoredComment>): StoredComment {
    return {
      id: overrides.id ?? `cmt_${this.nextComment++}`,
      organisationId: overrides.organisationId ?? 'org_1',
      matterId: overrides.matterId ?? 'mtr_1',
      documentId: overrides.documentId ?? 'doc_1',
      anchorVersionId: overrides.anchorVersionId ?? 'ver_1',
      paragraphId: overrides.paragraphId ?? 'para-1',
      endParagraphId: overrides.endParagraphId ?? null,
      startOffset: overrides.startOffset ?? 0,
      endOffset: overrides.endOffset ?? 4,
      body: overrides.body ?? 'Synthetic review note',
      authorId: overrides.authorId ?? 'usr_owner',
      authorName: overrides.authorName ?? 'Owner Reviewer',
      clientKey: overrides.clientKey ?? null,
      resolvedAt: overrides.resolvedAt ?? null,
      resolvedBy: overrides.resolvedBy ?? null,
      createdAt: overrides.createdAt ?? '2026-08-10T12:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-08-10T12:00:00.000Z',
    }
  }

  private storedReply(overrides: Partial<StoredReply>): StoredReply {
    return {
      id: overrides.id ?? `cmtr_${this.nextReply++}`,
      organisationId: overrides.organisationId ?? 'org_1',
      matterId: overrides.matterId ?? 'mtr_1',
      documentId: overrides.documentId ?? 'doc_1',
      commentId: overrides.commentId ?? null,
      importedCommentId: overrides.importedCommentId ?? null,
      importedParentFingerprint: overrides.importedParentFingerprint ?? null,
      body: overrides.body ?? 'Synthetic reply',
      authorId: overrides.authorId ?? 'usr_actor',
      authorName: overrides.authorName ?? 'Case Reviewer',
      clientKey: overrides.clientKey ?? null,
      createdAt: overrides.createdAt ?? '2026-08-10T13:30:00.000Z',
    }
  }
}
