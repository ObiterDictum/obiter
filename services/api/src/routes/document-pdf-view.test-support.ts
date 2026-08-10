import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { DocumentStatus } from '@obiter/contracts'
import type { AuthzUser, AuthzVariables } from '../authz'
import type { StorageService } from '../storage'
import { createDocumentPdfViewRoutes } from './document-pdf-view'

export const sourceObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source'
export const textObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/text'
export const layoutObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/layout.json'
export const extractedText = 'Alpha'
export const layout = {
  version: 1 as const,
  pages: [{ width: 612, height: 792 }],
  segments: [
    {
      start: 0,
      end: 5,
      pageIndex: 0,
      x: 72,
      y: 720,
      width: 30,
      height: 12,
    },
  ],
}

interface DatabaseOptions {
  status?: DocumentStatus
  fileType?: string
  currentVersion?: boolean
  currentVersionId?: string | null
  versionOrganisationId?: string
  versionMatterId?: string
  versionDocumentId?: string
  versionNumber?: number
  access?: 'owner' | 'view' | 'edit' | null
  provisionFails?: boolean
}

export class TestDatabase {
  readonly queries: string[] = []
  readonly transactionCommands: string[] = []

  constructor(private readonly options: DatabaseOptions = {}) {}

  pool() {
    const query = async (sql: string, parameters: unknown[] = []) => {
      this.queries.push(sql)
      if (sql.includes('from matter_documents')) {
        const [id, organisationId] = parameters
        const document = documents.get(String(id))
        return {
          rows:
            document &&
            document.organisation_id === organisationId &&
            document.deleted_at === null
              ? [
                  {
                    ...document,
                    current_version_id:
                      this.options.currentVersionId === undefined
                        ? document.current_version_id
                        : this.options.currentVersionId,
                  },
                ]
              : [],
        }
      }
      if (
        sql.includes('from document_versions') &&
        sql.includes('matter_document_id = $2')
      ) {
        return {
          rows:
            this.options.currentVersion === false
              ? []
              : [versionRow(this.options)],
        }
      }
      if (sql.includes('from document_versions')) {
        return {
          rows:
            this.options.currentVersion === false
              ? []
              : [versionRow(this.options)],
        }
      }
      if (sql.includes('left join matter_shares')) {
        return {
          rows: [
            {
              created_by:
                this.options.access === 'owner' ? 'usr_reader' : 'usr_owner',
              access_level:
                this.options.access === undefined
                  ? 'view'
                  : this.options.access,
            },
          ],
        }
      }
      throw new Error('Unexpected database query.')
    }

    // The external pg boundary used here is query/connect only; implementing
    // every Pool member would obscure the route gate behaviour under test.
    return {
      query,
      connect: async () => ({
        query: async (sql: string) => {
          const command = sql.trim()
          this.transactionCommands.push(command)
          if (
            this.options.provisionFails &&
            sql.includes('select "organisationId", role from users')
          ) {
            throw new Error('private provisioning diagnostic')
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
          return { rows: [] }
        },
        release: () => undefined,
      }),
    } as unknown as Pool
  }
}

export class MemoryStorage implements StorageService {
  readonly text = new Map<string, string>([
    [textObjectKey, extractedText],
    [layoutObjectKey, JSON.stringify(layout)],
  ])
  readonly textReads: string[] = []
  readonly textWrites: string[] = []
  readonly deletes: string[] = []
  readTextError: Error | null = null

  async readText(key: string) {
    this.textReads.push(key)
    if (this.readTextError) throw this.readTextError
    const value = this.text.get(key)
    if (value === undefined)
      throw Object.assign(new Error(`private missing key: ${key}`), {
        code: 'ENOENT',
      })
    return value
  }

  async writeText(key: string) {
    this.textWrites.push(key)
  }

  async delete(key: string) {
    this.deletes.push(key)
  }
}

function versionRow(options: DatabaseOptions = {}) {
  return {
    id: 'ver_1',
    organisation_id: options.versionOrganisationId ?? 'org_1',
    matter_id: options.versionMatterId ?? 'mtr_1',
    matter_document_id: options.versionDocumentId ?? 'doc_1',
    filename: 'document.pdf',
    file_type: options.fileType ?? 'pdf',
    size_bytes: '100',
    object_key: sourceObjectKey,
    text_object_key: textObjectKey,
    document_status: options.status ?? 'ready',
    failure_reason: null,
    version_number: options.versionNumber ?? 1,
    content_sha256: '0'.repeat(64),
    sync_state: 'synced',
    created_by: 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
  }
}

const documents = new Map([
  ['doc_1', documentRow('doc_1', 'org_1', null)],
  ['doc_cross', documentRow('doc_cross', 'org_2', null)],
  [
    'doc_deleted',
    documentRow('doc_deleted', 'org_1', '2026-08-10T11:00:00.000Z'),
  ],
])

function documentRow(
  id: string,
  organisationId: string,
  deletedAt: string | null,
) {
  return {
    id,
    organisation_id: organisationId,
    matter_id: 'mtr_1',
    current_version_id: 'ver_1',
    logical_key: 'logical',
    created_by: 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: deletedAt,
    deleted_by: deletedAt ? 'usr_owner' : null,
  }
}

export function routeApp(
  database: TestDatabase,
  storage: MemoryStorage,
  user: AuthzUser | null = {
    id: 'usr_reader',
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
    c.set('requestId', 'req_pdf_view')
    c.set('user', user)
    await next()
  })
  app.route('/', createDocumentPdfViewRoutes(database.pool(), storage))
  return { app, errors }
}
