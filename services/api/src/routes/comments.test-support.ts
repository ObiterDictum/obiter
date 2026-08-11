import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createCommentsRoutes } from './comments'

interface StoredComment {
  id: string
  organisationId: string
  matterId: string
  documentId: string
  anchorVersionId: string | null
  paragraphId: string
  startOffset: number
  endOffset: number
  body: string
  authorId: string
  authorName: string
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

interface TestDatabaseOptions {
  access?: 'owner' | 'view' | 'edit' | null
  status?: 'ready' | 'processing'
  fileType?: string
  auditFailure?: boolean
  transactionDocumentMissing?: boolean
}

export class TestDatabase {
  readonly queries: Array<{ sql: string; parameters: unknown[] }> = []
  readonly transactionCommands: string[] = []
  comments = new Map<string, StoredComment>()
  audits: Array<{
    entityType: string
    entityId: string
    action: string
    metadata: Record<string, unknown>
  }> = []
  private nextComment = 1

  constructor(private readonly options: TestDatabaseOptions = {}) {}

  seedComment(overrides: Partial<StoredComment> = {}) {
    const value: StoredComment = {
      id: overrides.id ?? `cmt_${this.nextComment++}`,
      organisationId: overrides.organisationId ?? 'org_1',
      matterId: overrides.matterId ?? 'mtr_1',
      documentId: overrides.documentId ?? 'doc_1',
      anchorVersionId: overrides.anchorVersionId ?? 'ver_1',
      paragraphId: overrides.paragraphId ?? 'para-1',
      startOffset: overrides.startOffset ?? 0,
      endOffset: overrides.endOffset ?? 4,
      body: overrides.body ?? 'Synthetic review note',
      authorId: overrides.authorId ?? 'usr_owner',
      authorName: overrides.authorName ?? 'Owner Reviewer',
      resolvedAt: overrides.resolvedAt ?? null,
      resolvedBy: overrides.resolvedBy ?? null,
      createdAt: overrides.createdAt ?? '2026-08-10T12:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-08-10T12:00:00.000Z',
    }
    this.comments.set(value.id, value)
    return value
  }

  pool() {
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        this.queries.push({ sql, parameters })
        if (sql.includes('left join document_comments')) {
          const [documentId, matterId, organisationId] = parameters as string[]
          if (!this.activeDocument(documentId, organisationId))
            return { rows: [] }
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
        }
        if (sql.includes('from matter_documents')) {
          const [documentId, organisationId] = parameters as string[]
          const document = this.activeDocument(documentId, organisationId)
          return { rows: document ? [document] : [] }
        }
        if (
          sql.includes('from document_versions') &&
          sql.includes('matter_document_id = $2')
        ) {
          return { rows: [versionRow(this.options)] }
        }
        if (sql.includes('from document_versions')) {
          return { rows: [versionRow(this.options)] }
        }
        if (sql.includes('left join matter_shares')) {
          return {
            rows: [
              {
                created_by:
                  this.options.access === 'owner' ? 'usr_actor' : 'usr_owner',
                access_level:
                  this.options.access === undefined
                    ? 'edit'
                    : this.options.access,
              },
            ],
          }
        }
        throw new Error('Unexpected direct database query.')
      },
      connect: async () => this.client(),
    } as unknown as Pool
  }

  private client() {
    let stagedComments = new Map(this.comments)
    let stagedAudits = [...this.audits]
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        this.queries.push({ sql, parameters })
        const command = sql.trim()
        if (
          command === 'begin' ||
          command === 'commit' ||
          command === 'rollback'
        ) {
          this.transactionCommands.push(command)
          if (command === 'commit') {
            this.comments = stagedComments
            this.audits = stagedAudits
          }
          return { rows: [] }
        }
        if (sql.includes('select "organisationId", role from users')) {
          return { rows: [{ organisationId: null, role: null }] }
        }
        if (sql.includes('insert into organisations')) {
          return {
            rows: [
              {
                id: 'org_1',
                name: 'Personal workspace',
                plan: 'private_beta',
              },
            ],
          }
        }
        if (sql.includes('join document_versions version')) {
          const [documentId, matterId, organisationId, versionId] =
            parameters as string[]
          const active = this.activeDocument(documentId, organisationId)
          return {
            rows:
              !this.options.transactionDocumentMissing &&
              active &&
              active.matter_id === matterId &&
              versionId === 'ver_1' &&
              (this.options.status ?? 'ready') === 'ready' &&
              (this.options.fileType ?? 'docx') === 'docx'
                ? [{ id: documentId }]
                : [],
          }
        }
        if (sql.includes('insert into document_comments')) {
          const [
            organisationId,
            matterId,
            documentId,
            anchorVersionId,
            paragraphId,
            startOffset,
            endOffset,
            body,
            authorId,
            authorName,
          ] = parameters as [
            string,
            string,
            string,
            string,
            string,
            number,
            number,
            string,
            string,
            string,
          ]
          const value = this.seedComment({
            id: `cmt_${this.nextComment++}`,
            organisationId,
            matterId,
            documentId,
            anchorVersionId,
            paragraphId,
            startOffset,
            endOffset,
            body,
            authorId,
            authorName,
            createdAt: '2026-08-10T13:00:00.000Z',
            updatedAt: '2026-08-10T13:00:00.000Z',
          })
          this.comments.delete(value.id)
          stagedComments.set(value.id, value)
          return { rows: [commentRow(value)] }
        }
        if (sql.includes('update document_comments')) {
          const [commentId, documentId, matterId, organisationId, resolvedBy] =
            parameters as string[]
          const existing = stagedComments.get(commentId)
          if (
            !existing ||
            existing.documentId !== documentId ||
            existing.matterId !== matterId ||
            existing.organisationId !== organisationId
          ) {
            return { rows: [] }
          }
          const resolved = existing.resolvedAt
            ? existing
            : {
                ...existing,
                resolvedAt: '2026-08-10T14:00:00.000Z',
                resolvedBy,
                updatedAt: '2026-08-10T14:00:00.000Z',
              }
          stagedComments.set(commentId, resolved)
          return { rows: [commentRow(resolved)] }
        }
        if (sql.includes('insert into audit_logs')) {
          if (this.options.auditFailure) throw new Error('audit insert failed')
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
        if (sql.includes('update users set')) return { rows: [] }
        throw new Error('Unexpected transaction database query.')
      },
      release: () => undefined,
    }
  }

  private activeDocument(id: string, organisationId: string) {
    if (id !== 'doc_1' || organisationId !== 'org_1') return null
    return documentRow()
  }
}

export function routeApp(
  database: TestDatabase,
  user: AuthzUser | null = {
    id: 'usr_actor',
    name: 'Case Reviewer',
    organisationId: 'org_1',
    role: 'member',
  },
) {
  const errors: string[] = []
  const app = new Hono<{ Variables: AuthzVariables }>()
  app.onError((error, c) => {
    errors.push(error.message)
    return c.json(
      {
        error: {
          code: 'storage_unavailable',
          message: 'The API could not complete the request.',
          requestId: c.get('requestId'),
        },
      },
      500,
    )
  })
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_comments')
    c.set('user', user)
    await next()
  })
  app.route('/', createCommentsRoutes(database.pool()))
  return { app, errors }
}

export function createComment(
  app: ReturnType<typeof routeApp>['app'],
  body: unknown,
) {
  return app.request('/api/documents/doc_1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function resolveComment(
  app: ReturnType<typeof routeApp>['app'],
  commentId: string,
  body: unknown = {},
) {
  return app.request(`/api/documents/doc_1/comments/${commentId}/resolve`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function documentRow() {
  return {
    id: 'doc_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    current_version_id: 'ver_1',
    logical_key: 'logical-1',
    created_by: 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
  }
}

function versionRow(options: TestDatabaseOptions) {
  return {
    id: 'ver_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    matter_document_id: 'doc_1',
    filename: 'synthetic.docx',
    file_type: options.fileType ?? 'docx',
    size_bytes: '100',
    object_key: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    text_object_key:
      'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/text',
    document_status: options.status ?? 'ready',
    failure_reason: null,
    version_number: 1,
    content_sha256: '0'.repeat(64),
    sync_state: 'synced',
    created_by: 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
  }
}

function commentRow(comment: StoredComment) {
  return {
    id: comment.id,
    document_id: comment.documentId,
    anchor_version_id: comment.anchorVersionId,
    paragraph_id: comment.paragraphId,
    start_offset: comment.startOffset,
    end_offset: comment.endOffset,
    body: comment.body,
    author_id: comment.authorId,
    author_name: comment.authorName,
    resolved_at: comment.resolvedAt,
    resolved_by: comment.resolvedBy,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  }
}
