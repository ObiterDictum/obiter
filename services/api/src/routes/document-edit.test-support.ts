import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import type { AuthzUser, AuthzVariables } from '../authz'
import { createDocumentObjectKey } from '../database'
import { parseDocx } from '@obiter/ooxml'
import { createDocumentEditRoutes } from './document-edit'
import type { StorageService } from '../storage'

export const sourceBytes = await readFile(
  '../../data/evals/redact/demo-fixture.docx',
)
export const sourceKey = createDocumentObjectKey({
  organisationId: 'org_1',
  matterId: 'mtr_1',
  documentId: 'doc_1',
  versionId: 'ver_1',
})
const sourceModel = await parseDocx(sourceBytes)
export const editableRunId = sourceModel.model.stories.find(
  ({ kind }) => kind === 'document',
)?.paragraphs[0]?.runs[0]?.id
if (!editableRunId) throw new Error('Edit fixture has no ordinary text run.')

type VersionRow = ReturnType<typeof versionRow>
type Audit = {
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown>
}

export type EditDatabaseOptions = {
  access?: 'owner' | 'view' | 'edit' | null
  status?: string
  fileType?: string
  currentVersionId?: string | null
  transactionDocumentMissing?: boolean
  auditFailure?: boolean
}

export class EditDatabase {
  readonly queries: string[] = []
  readonly transactionCommands: string[] = []
  readonly versions = new Map<string, VersionRow>()
  readonly audits: Audit[] = []
  currentVersionId: string | null
  private lockTail = Promise.resolve()

  constructor(readonly options: EditDatabaseOptions = {}) {
    this.currentVersionId =
      options.currentVersionId === undefined
        ? 'ver_1'
        : options.currentVersionId
    this.versions.set(
      'ver_1',
      versionRow('ver_1', {
        status: options.status,
        fileType: options.fileType,
      }),
    )
  }

  pool() {
    const pool = {
      query: async (sql: string, parameters: unknown[] = []) =>
        this.routeQuery(sql, parameters),
      connect: async () => new EditTransaction(this),
    }
    return pool as unknown as Pool
  }

  async acquireLock() {
    let release: () => void = () => undefined
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.lockTail
    this.lockTail = next
    await previous
    return release
  }

  private routeQuery(sql: string, parameters: unknown[]) {
    this.queries.push(sql)
    if (sql.includes('from matter_documents')) {
      const [id, organisationId] = parameters
      const available = id === 'doc_1' && organisationId === 'org_1'
      return {
        rows: available ? [documentRow(this.currentVersionId)] : [],
      }
    }
    if (
      sql.includes('from document_versions') &&
      sql.includes('matter_document_id = $2')
    ) {
      return {
        rows: [...this.versions.values()].filter(
          ({ organisation_id, matter_document_id }) =>
            organisation_id === parameters[0] &&
            matter_document_id === parameters[1],
        ),
      }
    }
    if (sql.includes('from document_versions')) {
      const row = this.versions.get(String(parameters[0]))
      return { rows: row ? [row] : [] }
    }
    if (sql.includes('left join matter_shares')) {
      return {
        rows: [
          {
            created_by:
              this.options.access === 'owner' ? 'usr_editor' : 'usr_owner',
            access_level:
              this.options.access === undefined ? 'edit' : this.options.access,
          },
        ],
      }
    }
    throw new Error('Unexpected route query.')
  }
}

class EditTransaction {
  private releaseLock: (() => void) | null = null
  private stagedVersion: VersionRow | null = null
  private stagedPointer: string | null = null
  private readonly stagedAudits: Audit[] = []

  constructor(private readonly database: EditDatabase) {}

  async query(sql: string, parameters: unknown[] = []) {
    const command = sql.trim()
    if (command === 'begin') {
      this.database.transactionCommands.push('begin')
      return { rows: [] }
    }
    if (command === 'commit') {
      if (this.stagedVersion) {
        this.database.versions.set(this.stagedVersion.id, this.stagedVersion)
      }
      if (this.stagedPointer) {
        this.database.currentVersionId = this.stagedPointer
      }
      this.database.audits.push(...this.stagedAudits)
      this.database.transactionCommands.push('commit')
      this.unlock()
      return { rows: [] }
    }
    if (command === 'rollback') {
      this.database.transactionCommands.push('rollback')
      this.unlock()
      return { rows: [] }
    }
    this.database.queries.push(sql)
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
    if (sql.includes('update users')) return { rows: [] }
    if (sql.includes('for update of document')) {
      this.releaseLock = await this.database.acquireLock()
      if (this.database.options.transactionDocumentMissing) return { rows: [] }
      const base = this.database.versions.get(String(parameters[3]))
      return {
        rows: [
          {
            current_version_id: this.database.currentVersionId,
            matter_id: 'mtr_1',
            base_id: base?.id ?? null,
            version_number: base?.version_number ?? null,
            filename: base?.filename ?? null,
            file_type: base?.file_type ?? null,
          },
        ],
      }
    }
    if (sql.includes('insert into document_versions')) {
      this.stagedVersion = versionRow(String(parameters[0]), {
        versionNumber: Number(parameters[8]),
        filename: String(parameters[4]),
        fileType: String(parameters[5]),
        sizeBytes: String(parameters[6]),
        objectKey: String(parameters[7]),
        contentSha256: String(parameters[9]),
        createdBy: String(parameters[10]),
        textObjectKey: null,
      })
      return { rows: [] }
    }
    if (sql.includes('update matter_documents')) {
      if (this.database.currentVersionId !== parameters[3]) return { rows: [] }
      this.stagedPointer = String(parameters[4])
      return { rows: [{ id: 'doc_1' }] }
    }
    if (sql.includes('insert into audit_logs')) {
      if (this.database.options.auditFailure) {
        throw new Error('private audit diagnostic')
      }
      this.stagedAudits.push({
        entityType: String(parameters[2]),
        entityId: String(parameters[3]),
        action: String(parameters[4]),
        metadata: JSON.parse(String(parameters[5])) as Record<string, unknown>,
      })
      return { rows: [] }
    }
    throw new Error('Unexpected transaction query.')
  }

  release() {
    this.unlock()
  }

  private unlock() {
    this.releaseLock?.()
    this.releaseLock = null
  }
}

export class EditStorage implements StorageService {
  readonly binary = new Map<string, Buffer>([[sourceKey, sourceBytes]])
  readonly reads: string[] = []
  readonly writes: string[] = []
  readonly deletes: string[] = []
  writeFailure = false
  deleteFailure = false
  readGate: Promise<void> | null = null

  async readText(_key: string): Promise<string> {
    throw new Error('Text storage is not used by document editing.')
  }

  async writeText(_key: string, _text: string) {
    throw new Error('Text storage is not used by document editing.')
  }

  async readBinary(key: string) {
    this.reads.push(key)
    await this.readGate
    const value = this.binary.get(key)
    if (!value) throw new Error('private missing-object diagnostic')
    return value
  }

  async writeBinary(key: string, contents: Buffer) {
    this.writes.push(key)
    this.binary.set(key, contents)
    if (this.writeFailure) throw new Error('private write diagnostic')
  }

  async delete(key: string) {
    this.deletes.push(key)
    if (this.deleteFailure) throw new Error('private cleanup diagnostic')
    this.binary.delete(key)
  }
}

export function routeApp(
  database: EditDatabase,
  storage = new EditStorage(),
  user: AuthzUser | null = {
    id: 'usr_editor',
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
    c.set('requestId', 'req_edit')
    c.set('user', user)
    await next()
  })
  app.route('/', createDocumentEditRoutes(database.pool(), storage))
  return { app, storage, errors }
}

export function editRequest(baseVersionId = 'ver_1', text = 'Revised text') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId,
      operations: [{ type: 'replace_run_text', runId: editableRunId, text }],
    }),
  }
}

function documentRow(currentVersionId: string | null) {
  return {
    id: 'doc_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    current_version_id: currentVersionId,
    logical_key: 'logical',
    created_by: 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
  }
}

function versionRow(
  id: string,
  options: {
    status?: string
    versionNumber?: number
    filename?: string
    fileType?: string
    sizeBytes?: string
    objectKey?: string
    contentSha256?: string
    createdBy?: string
    textObjectKey?: string | null
  } = {},
) {
  return {
    id,
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    matter_document_id: 'doc_1',
    filename: options.filename ?? 'synthetic.docx',
    file_type: options.fileType ?? 'docx',
    size_bytes: options.sizeBytes ?? String(sourceBytes.byteLength),
    object_key: options.objectKey ?? sourceKey,
    text_object_key:
      options.textObjectKey === undefined
        ? 'source-text-key'
        : options.textObjectKey,
    document_status: options.status ?? 'ready',
    failure_reason: null,
    version_number: options.versionNumber ?? 1,
    content_sha256: options.contentSha256 ?? '0'.repeat(64),
    sync_state: 'synced',
    created_by: options.createdBy ?? 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
  }
}
