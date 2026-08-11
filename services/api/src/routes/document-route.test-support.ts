import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { DocumentStatus } from '@obiter/contracts'
import { expect } from 'vitest'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { deriveDocumentSiblingObjectKey } from '../document-artifact-store'
import type { StorageService } from '../storage'

export const sourceObjectKey = createDocumentObjectKey({
  organisationId: 'org_1',
  matterId: 'mtr_1',
  documentId: 'doc_1',
  versionId: 'ver_1',
})
export const textObjectKey = deriveDocumentSiblingObjectKey(
  sourceObjectKey,
  'text',
)
export const layoutObjectKey = deriveDocumentSiblingObjectKey(
  sourceObjectKey,
  'layout.json',
)
export const modelObjectKey = deriveDocumentSiblingObjectKey(
  sourceObjectKey,
  'model.json',
)

export interface TestDatabaseOptions {
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
  objectKey?: string
  textObjectKey?: string | null
  filename?: string
  sizeBytes?: string
}

export class TestDatabase {
  readonly queries: string[] = []
  readonly transactionCommands: string[] = []

  constructor(private readonly options: TestDatabaseOptions = {}) {}

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

    // The route's external pg boundary uses only query and connect; implementing
    // the rest of Pool would obscure the gate behaviour this fake exercises.
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

export interface MemoryStorageOptions {
  text?: ReadonlyArray<readonly [string, string]>
  binary?: ReadonlyArray<readonly [string, Buffer]>
}

export class MemoryStorage implements StorageService {
  readonly text: Map<string, string>
  readonly binary: Map<string, Buffer>
  readonly textReads: string[] = []
  readonly binaryReads: string[] = []
  readonly textWrites: Array<{ key: string; text: string }> = []
  readonly deletes: string[] = []
  readTextError: Error | null = null
  writeTextError: Error | null = null
  binaryGate: Promise<void> | null = null

  constructor(options: MemoryStorageOptions = {}) {
    this.text = new Map(options.text)
    this.binary = new Map(options.binary)
  }

  async readText(key: string) {
    this.textReads.push(key)
    if (this.readTextError) throw this.readTextError
    const value = this.text.get(key)
    if (value === undefined) throw missingObjectError()
    return value
  }

  async writeText(key: string, text: string) {
    this.textWrites.push({ key, text })
    if (this.writeTextError) throw this.writeTextError
    this.text.set(key, text)
  }

  async readBinary(key: string) {
    this.binaryReads.push(key)
    await this.binaryGate
    const value = this.binary.get(key)
    if (!value) throw missingObjectError()
    return value
  }

  async writeBinary(key: string, contents: Buffer) {
    this.binary.set(key, contents)
  }

  async delete(key: string) {
    this.deletes.push(key)
    this.text.delete(key)
    this.binary.delete(key)
  }
}

interface RouteAppOptions {
  database: TestDatabase
  storage: StorageService
  user: AuthzUser | null
  requestId: string
  createRoutes: (
    pool: Pool,
    storage: StorageService,
  ) => Hono<{ Variables: AuthzVariables }>
}

export function createRouteApp(options: RouteAppOptions) {
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
    c.set('requestId', options.requestId)
    c.set('user', options.user)
    await next()
  })
  app.route('/', options.createRoutes(options.database.pool(), options.storage))
  return { app, errors }
}

export async function expectDocument404(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'document_not_found' },
  })
}

export function queryKind(sql: string) {
  if (sql.includes('from matter_documents')) return 'document'
  if (sql.includes('matter_document_id = $2')) return 'versions'
  if (sql.includes('from document_versions')) return 'current-version'
  if (sql.includes('left join matter_shares')) return 'matter-access'
  return 'unknown'
}

function missingObjectError() {
  return Object.assign(new Error('object missing'), { code: 'ENOENT' })
}

function versionRow(options: TestDatabaseOptions) {
  return {
    id: 'ver_1',
    organisation_id: options.versionOrganisationId ?? 'org_1',
    matter_id: options.versionMatterId ?? 'mtr_1',
    matter_document_id: options.versionDocumentId ?? 'doc_1',
    filename: options.filename ?? 'document.bin',
    file_type: options.fileType ?? 'docx',
    size_bytes: options.sizeBytes ?? '100',
    object_key: options.objectKey ?? sourceObjectKey,
    text_object_key:
      options.textObjectKey === undefined
        ? textObjectKey
        : options.textObjectKey,
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
