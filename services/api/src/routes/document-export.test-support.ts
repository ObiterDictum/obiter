import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { parseDocx } from '@obiter/ooxml'
import type { AuthzUser } from '../authz'
import { createDocumentExportRoutes } from './document-export'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  queryKind,
  sourceObjectKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions as SharedTestDatabaseOptions,
} from './document-route.test-support'

const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
const parsed = await parseDocx(fixture)
export const sourceBytes = fixture
export const fixtureParagraphId =
  parsed.model.stories.find((story) => story.kind === 'document')?.paragraphs[0]
    ?.id ?? ''

export { expectDocument404, queryKind, sourceObjectKey }

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
  commentsDocumentMissing?: boolean
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
  private readonly exportOptions: TestDatabaseOptions

  constructor(options: TestDatabaseOptions = {}) {
    super({
      filename: 'private.docx',
      sizeBytes: String(fixture.byteLength),
      ...options,
    })
    this.exportOptions = options
  }

  seedComment(overrides: Partial<StoredComment> = {}) {
    const value = {
      id: overrides.id ?? `cmt_${this.nextComment++}`,
      organisationId: overrides.organisationId ?? 'org_1',
      matterId: overrides.matterId ?? 'mtr_1',
      documentId: overrides.documentId ?? 'doc_1',
      anchorVersionId: overrides.anchorVersionId ?? 'ver_1',
      paragraphId: overrides.paragraphId ?? fixtureParagraphId,
      startOffset: overrides.startOffset ?? 0,
      endOffset: overrides.endOffset ?? 0,
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

  override pool() {
    const shared = super.pool()
    return {
      query: async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes('left join document_comments')) {
          this.queries.push(sql)
          const [documentId, matterId, organisationId] = parameters as string[]
          if (
            this.exportOptions.commentsDocumentMissing ||
            documentId !== 'doc_1' ||
            matterId !== 'mtr_1' ||
            organisationId !== 'org_1'
          ) {
            return { rows: [] }
          }
          const comments = [...this.comments.values()]
          return {
            rows:
              comments.length === 0
                ? [{ active_document_id: documentId }]
                : comments.map((comment) => ({
                    active_document_id: documentId,
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
                  })),
          }
        }
        if (sql.includes('insert into audit_logs')) {
          this.queries.push(sql)
          const [, , entityType, entityId, action, metadata] =
            parameters as string[]
          this.audits.push({
            entityType,
            entityId,
            action,
            metadata: JSON.parse(metadata) as Record<string, unknown>,
          })
          return { rows: [] }
        }
        return shared.query(sql, parameters)
      },
      connect: shared.connect,
    } as unknown as Pool
  }
}

export class MemoryStorage extends SharedMemoryStorage {
  constructor() {
    super({ binary: [[sourceObjectKey, fixture]] })
  }
}

export function routeApp(
  database: TestDatabase,
  storage: MemoryStorage,
  user: AuthzUser | null = {
    id: 'usr_viewer',
    organisationId: 'org_1',
    role: 'member',
  },
) {
  return createRouteApp({
    database,
    storage,
    user,
    requestId: 'req_export',
    createRoutes: createDocumentExportRoutes,
  })
}
