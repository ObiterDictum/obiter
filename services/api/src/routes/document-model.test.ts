import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  documentModelResponseSchema,
  type DocumentStatus,
} from '@obiter/contracts'
import { parseDocx, parseModelJson, serialiseModelJson } from '@obiter/ooxml'
import { describe, expect, it, vi } from 'vitest'
import type { AuthzUser, AuthzVariables } from '../authz'
import type { StorageService } from '../storage'
import { createDocumentModelRoutes } from './document-model'

const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
const cachedModelJson = serialiseModelJson(await parseDocx(fixture))
const modelObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/model.json'
const sourceObjectKey =
  'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source'

interface DatabaseOptions {
  status?: DocumentStatus
  fileType?: string
  currentVersion?: boolean
  accessLevel?: 'view' | 'edit' | null
  objectKey?: string
}

class TestDatabase {
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

class MemoryStorage implements StorageService {
  readonly text = new Map<string, string>()
  readonly binary = new Map<string, Buffer>([[sourceObjectKey, fixture]])
  readonly textReads: string[] = []
  readonly binaryReads: string[] = []
  readonly textWrites: Array<{ key: string; text: string }> = []
  readTextError: Error | null = null
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

function routeApp(
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

async function expectDocument404(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'document_not_found' },
  })
}

describe('GET /api/documents/:id/model gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      '/api/documents/doc_1/model',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.textReads).toEqual([])
  })

  it('provisions an organisation for an org-less user before serving', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.text.set(modelObjectKey, cachedModelJson)

    const response = await routeApp(database, storage, {
      id: 'usr_viewer',
      organisationId: null,
      role: null,
    }).app.request('/api/documents/doc_1/model')

    expect(response.status).toBe(200)
    expect(database.transactionCommands).toContain('begin')
    expect(database.transactionCommands).toContain('commit')
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform 404 for a %s document without storage access',
    async (_name, id) => {
      const database = new TestDatabase()
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        `/api/documents/${id}/model`,
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ accessLevel: null })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )

    await expectDocument404(response)
    expect(storage.textReads).toEqual([])
    expect(database.queries.at(-1)).toContain('left join matter_shares')
  })

  it('returns the uniform 404 when the current version is absent or not ready', async () => {
    for (const options of [
      { currentVersion: false },
      { status: 'processing' as const },
    ]) {
      const database = new TestDatabase(options)
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/model',
      )
      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
    }
  })

  it.each(['pdf', 'txt'])(
    'returns the uniform 404 for a ready %s version',
    async (fileType) => {
      const database = new TestDatabase({ fileType })
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/model',
      )

      await expectDocument404(response)
      expect(storage.textReads).toEqual([])
    },
  )
})

describe('GET /api/documents/:id/model storage boundary', () => {
  it('serves a validated cache hit to a view grantee with only wrapper fields', async () => {
    const database = new TestDatabase({ accessLevel: 'view' })
    const storage = new MemoryStorage()
    storage.text.set(modelObjectKey, cachedModelJson)

    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )
    const body = documentModelResponseSchema.parse(await response.json())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      documentId: 'doc_1',
      versionId: 'ver_1',
      versionNumber: 1,
      model: parseModelJson(cachedModelJson),
    })
    expect(Object.keys(body)).toEqual([
      'documentId',
      'versionId',
      'versionNumber',
      'model',
    ])
    expect(JSON.stringify(body)).not.toContain('objectKey')
    expect(JSON.stringify(body)).not.toContain('private.docx')
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([])
    expect(database.queries.map(queryKind)).toEqual([
      'document',
      'versions',
      'current-version',
      'matter-access',
    ])
  })

  it('generates a missing cache from the immutable source at the exact derived key', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()

    const response = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/model',
    )

    expect(response.status).toBe(200)
    expect(storage.textReads).toEqual([modelObjectKey])
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toEqual([
      { key: modelObjectKey, text: cachedModelJson },
    ])
    expect(parseModelJson(storage.text.get(modelObjectKey) ?? '')).toEqual(
      parseModelJson(cachedModelJson),
    )
  })

  it.each([
    ['malformed JSON', '{malformed cache'],
    ['an invalid wire value', JSON.stringify({ version: 1, stories: 'no' })],
  ])(
    'regenerates and replaces cached model JSON containing %s',
    async (_name, cachedJson) => {
      const database = new TestDatabase()
      const storage = new MemoryStorage()
      storage.text.set(modelObjectKey, cachedJson)

      const response = await routeApp(database, storage).app.request(
        '/api/documents/doc_1/model',
      )

      expect(response.status).toBe(200)
      expect(storage.binaryReads).toEqual([sourceObjectKey])
      expect(storage.text.get(modelObjectKey)).toBe(cachedModelJson)
    },
  )

  it('coalesces concurrent generation within the process', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    let releaseBinary: () => void = () => undefined
    storage.binaryGate = new Promise<void>((resolve) => {
      releaseBinary = resolve
    })
    const app = routeApp(database, storage).app

    const first = app.request('/api/documents/doc_1/model')
    const second = app.request('/api/documents/doc_1/model')
    await vi.waitFor(() => expect(storage.binaryReads).toHaveLength(1))
    releaseBinary()

    const responses = await Promise.all([first, second])
    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(storage.binaryReads).toEqual([sourceObjectKey])
    expect(storage.textWrites).toHaveLength(1)
  })

  it('does not convert non-missing storage failures into cache misses', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.readTextError = Object.assign(
      new Error('EACCES diagnostic for a private object path'),
      { code: 'EACCES' },
    )
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(storage.binaryReads).toEqual([])
    expect(body).not.toContain('EACCES')
    expect(errors).toEqual(['The document model could not be read.'])
  })

  it('keeps source parser diagnostics behind the generic API boundary', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    storage.binary.set(sourceObjectKey, Buffer.from('PK private parser marker'))
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).not.toContain('parser marker')
    expect(errors).toEqual(['The document model could not be read.'])
  })

  it('refuses a quarantine source key before any storage read', async () => {
    const database = new TestDatabase({
      objectKey: 'org/org_1/quarantine/private/source',
    })
    const storage = new MemoryStorage()
    const { app, errors } = routeApp(database, storage)

    const response = await app.request('/api/documents/doc_1/model')

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(storage.textReads).toEqual([])
    expect(storage.binaryReads).toEqual([])
    expect(errors.join(' ')).not.toContain('quarantine')
  })
})

function queryKind(sql: string) {
  if (sql.includes('from matter_documents')) return 'document'
  if (sql.includes('matter_document_id = $2')) return 'versions'
  if (sql.includes('from document_versions')) return 'current-version'
  if (sql.includes('left join matter_shares')) return 'matter-access'
  return 'unknown'
}
