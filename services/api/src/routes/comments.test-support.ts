import type { Pool, PoolClient } from 'pg'
import type { DocumentModelWire } from '@obiter/contracts'
import type { AuthzUser } from '../authz'
import { createCommentsRoutes } from './comments'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  modelObjectKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions as SharedTestDatabaseOptions,
} from './document-route.test-support'

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

interface TestDatabaseOptions extends SharedTestDatabaseOptions {
  auditFailure?: boolean
  transactionDocumentMissing?: boolean
}

const commentModel = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'para-1',
          runs: [
            {
              id: 'text-1',
              text: 'A😀 synthetic paragraph',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
} satisfies DocumentModelWire

export const cachedCommentModelJson = JSON.stringify(commentModel)
export { expectDocument404, modelObjectKey }

export class MemoryStorage extends SharedMemoryStorage {
  constructor() {
    super({ text: [[modelObjectKey, cachedCommentModelJson]] })
  }
}

export class TestDatabase extends SharedTestDatabase {
  comments = new Map<string, StoredComment>()
  audits: Array<{
    entityType: string
    entityId: string
    action: string
    metadata: Record<string, unknown>
  }> = []
  private nextComment = 1

  constructor(private readonly commentOptions: TestDatabaseOptions = {}) {
    super({ access: 'edit', ...commentOptions })
  }

  seedComment(overrides: Partial<StoredComment> = {}) {
    const value = this.storedComment(overrides)
    this.comments.set(value.id, value)
    return value
  }

  override pool() {
    const sharedPool = super.pool()
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
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
    let stagedAudits = [...this.audits]
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
            this.audits = stagedAudits
          }
          return { rows: [] }
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
        if (sql.includes('insert into document_comments')) {
          this.queries.push(sql)
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
          const value = this.storedComment({
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
          stagedComments.set(value.id, value)
          return { rows: [commentRow(value)] }
        }
        if (sql.includes('update document_comments')) {
          this.queries.push(sql)
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

  private storedComment(overrides: Partial<StoredComment>) {
    return {
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
  storage = new MemoryStorage(),
) {
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_comments',
      createRoutes: createCommentsRoutes,
    }),
    storage,
  }
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
