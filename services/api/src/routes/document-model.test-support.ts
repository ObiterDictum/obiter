import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { DocumentStatus } from '@obiter/contracts'
import { parseDocx, serialiseModelJson } from '@obiter/ooxml'
import { expect } from 'vitest'
import type { AuthzUser, AuthzVariables } from '../authz'
import type { StorageService } from '../storage'
import { createDocumentModelRoutes } from './document-model'

const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
export const cachedModelJson = serialiseModelJson(await parseDocx(fixture))
export const modelObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/model.json'
export const sourceObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source'

interface DatabaseOptions {
  status?: DocumentStatus
  fileType?: string
  currentVersion?: boolean
  accessLevel?: 'view' | 'edit' | null
  objectKey?: string
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
              ? [document]
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
              created_by: 'usr_owner',
              access_level:
                this.options.accessLevel === undefined
                  ? 'view'
                  : this.options.accessLevel,
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
  readonly text = new Map<string, string>()
  readonly binary = new Map<string, Buffer>([[sourceObjectKey, fixture]])
  readonly textReads: string[] = []
  readonly binaryReads: string[] = []
  readonly textWrites: Array<{ key: string; text: string }> = []
  readTextError: Error | null = null
  writeTextError: Error | null = null
  binaryGate: Promise<void> | null = null

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
    this.text.delete(key)
    this.binary.delete(key)
  }
}

function missingObjectError() {
  return Object.assign(new Error('object missing'), { code: 'ENOENT' })
}

function versionRow(options: DatabaseOptions = {}) {
  return {
    id: 'ver_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    matter_document_id: 'doc_1',
    filename: 'private.docx',
    file_type: options.fileType ?? 'docx',
    size_bytes: String(fixture.byteLength),
    object_key: options.objectKey ?? sourceObjectKey,
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
    id: 'usr_viewer',
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
    c.set('requestId', 'req_model')
    c.set('user', user)
    await next()
  })
  app.route('/', createDocumentModelRoutes(database.pool(), storage))
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
