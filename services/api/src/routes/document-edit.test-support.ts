import { readFile } from 'node:fs/promises'
import type { Pool, PoolClient } from 'pg'
import type { AuthzUser } from '../authz'
import { parseDocx } from '@obiter/ooxml'
import { createDocumentEditRoutes } from './document-edit'
import {
  createRouteApp,
  expectDocument404,
  MemoryStorage as SharedMemoryStorage,
  sourceObjectKey as sourceKey,
  TestDatabase as SharedTestDatabase,
  type TestDatabaseOptions as SharedTestDatabaseOptions,
} from './document-route.test-support'

export const sourceBytes = await readFile(
  '../../data/evals/redact/demo-fixture.docx',
)
const sourceModel = await parseDocx(sourceBytes)
export const editableRunId = sourceModel.model.stories.find(
  ({ kind }) => kind === 'document',
)?.paragraphs[0]?.runs[0]?.id
if (!editableRunId) throw new Error('Edit fixture has no ordinary text run.')

type VersionRow = ReturnType<typeof versionRow>
type Audit = {
  userId?: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown>
}

export interface EditDatabaseOptions extends SharedTestDatabaseOptions {
  transactionDocumentMissing?: boolean
  auditFailure?: boolean
  commitResponseFailure?: boolean
}

export { expectDocument404, sourceKey }

export class EditDatabase extends SharedTestDatabase {
  readonly versions = new Map<string, VersionRow>()
  readonly audits: Audit[] = []
  currentVersionId: string | null
  private lockTail = Promise.resolve()

  constructor(private readonly editOptions: EditDatabaseOptions = {}) {
    super({
      access: 'edit',
      objectKey: sourceKey,
      textObjectKey: 'source-text-key',
      filename: 'synthetic.docx',
      sizeBytes: String(sourceBytes.byteLength),
      ...editOptions,
    })
    this.currentVersionId =
      editOptions.currentVersionId === undefined
        ? 'ver_1'
        : editOptions.currentVersionId
    this.versions.set(
      'ver_1',
      versionRow('ver_1', {
        status: editOptions.status,
        fileType: editOptions.fileType,
      }),
    )
  }

  override pool() {
    const sharedPool = super.pool()
    const query = async (sql: string, parameters: unknown[] = []) => {
      if (
        sql.includes('from matter_documents') &&
        String(parameters[0]) === 'doc_1'
      ) {
        this.queries.push(sql)
        const access =
          this.options.access === undefined ? 'view' : this.options.access
        const requiredLevel = parameters[4]
        const allowed =
          access === 'owner' ||
          access === 'edit' ||
          (access === 'view' && requiredLevel === 'view')
        return {
          rows: allowed
            ? [
                {
                  id: 'doc_1',
                  organisation_id: 'org_1',
                  matter_id: 'mtr_1',
                  current_version_id: this.currentVersionId,
                  logical_key: 'logical',
                  created_by: 'usr_owner',
                  created_at: '2026-08-10T10:00:00.000Z',
                  updated_at: '2026-08-10T10:00:00.000Z',
                  deleted_at: null,
                  deleted_by: null,
                },
              ]
            : [],
        }
      }
      if (
        sql.includes('from document_versions') &&
        sql.includes('matter_document_id = $2')
      ) {
        this.queries.push(sql)
        return {
          rows: [...this.versions.values()].sort(
            (left, right) => right.version_number - left.version_number,
          ),
        }
      }
      if (sql.includes('from document_versions')) {
        this.queries.push(sql)
        const version = this.versions.get(String(parameters[0]))
        return { rows: version ? [version] : [] }
      }
      return sharedPool.query(sql, parameters)
    }
    return {
      query,
      connect: async () => this.client(await sharedPool.connect()),
    } as unknown as Pool
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

  private client(sharedClient: PoolClient) {
    return new EditTransaction(this, sharedClient, this.editOptions)
  }
}

class EditTransaction {
  private releaseLock: (() => void) | null = null
  private stagedVersion: VersionRow | null = null
  private stagedPointer: string | null = null
  private readonly stagedAudits: Audit[] = []
  private lockChecked = false

  constructor(
    private readonly database: EditDatabase,
    private readonly sharedClient: PoolClient,
    private readonly options: EditDatabaseOptions,
  ) {}

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
      if (this.options.commitResponseFailure) {
        throw new Error('private commit response diagnostic')
      }
      return { rows: [] }
    }
    if (command === 'rollback') {
      this.database.transactionCommands.push('rollback')
      this.unlock()
      return { rows: [] }
    }

    if (sql.includes('left join document_versions current')) {
      this.recordQuery(sql)
      requireSql(sql, 'for update of document')
      if (
        this.lockChecked ||
        this.stagedVersion ||
        this.stagedPointer ||
        this.stagedAudits.length > 0
      ) {
        throw new Error('The current version must be rechecked before writes.')
      }
      this.releaseLock = await this.database.acquireLock()
      this.lockChecked = true
      if (this.options.transactionDocumentMissing) return { rows: [] }
      const current = this.database.currentVersionId
        ? this.database.versions.get(this.database.currentVersionId)
        : undefined
      const base = this.database.versions.get(String(parameters[3]))
      return {
        rows: [
          {
            current_id: current?.id ?? null,
            current_organisation_id: current?.organisation_id ?? null,
            current_matter_id: current?.matter_id ?? null,
            current_document_id: current?.matter_document_id ?? null,
            current_filename: current?.filename ?? null,
            current_file_type: current?.file_type ?? null,
            current_object_key: current?.object_key ?? null,
            current_status: current?.document_status ?? null,
            current_version_number: current?.version_number ?? null,
            base_id: base?.id ?? null,
            base_organisation_id: base?.organisation_id ?? null,
            base_matter_id: base?.matter_id ?? null,
            base_document_id: base?.matter_document_id ?? null,
            base_filename: base?.filename ?? null,
            base_file_type: base?.file_type ?? null,
            base_object_key: base?.object_key ?? null,
            base_status: base?.document_status ?? null,
            base_version_number: base?.version_number ?? null,
          },
        ],
      }
    }
    if (sql.includes('from matter_documents document')) {
      this.recordQuery(sql)
      requireSql(sql, 'document.current_version_id')
      requireSql(sql, 'base.id = $4')
      requireSql(sql, 'for update of document')
      if (
        this.lockChecked ||
        this.stagedVersion ||
        this.stagedPointer ||
        this.stagedAudits.length > 0
      ) {
        throw new Error('The base version must be rechecked before writes.')
      }
      this.releaseLock = await this.database.acquireLock()
      this.lockChecked = true
      if (this.options.transactionDocumentMissing) return { rows: [] }
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
    if (sql.includes('from audit_logs audit')) {
      this.recordQuery(sql)
      const existing = this.database.audits.find(
        (audit) =>
          audit.userId === parameters[2] &&
          audit.entityId === parameters[1] &&
          audit.action === 'document.collaboration_merge' &&
          audit.metadata.syncId === parameters[3] &&
          audit.metadata.outcome === 'merged',
      )
      const versionId = existing?.metadata.newVersionId
      const version =
        typeof versionId === 'string'
          ? this.database.versions.get(versionId)
          : undefined
      return {
        rows:
          existing && version
            ? [
                {
                  base_version_id: existing.metadata.baseVersionId,
                  operations_sha256: existing.metadata.operationsSha256 ?? null,
                  version_id: version.id,
                  version_number: version.version_number,
                },
              ]
            : [],
      }
    }
    if (sql.includes('insert into document_versions')) {
      this.requireLockedWrite()
      this.recordQuery(sql)
      this.stagedVersion = versionRow(String(parameters[0]), {
        versionNumber: Number(parameters[11]),
        filename: String(parameters[4]),
        fileType: String(parameters[5]),
        sizeBytes: String(parameters[6]),
        objectKey: String(parameters[7]),
        textObjectKey: parameters[8] === null ? null : String(parameters[8]),
        status: String(parameters[9]),
        failureReason: parameters[10] === null ? null : String(parameters[10]),
        contentSha256: String(parameters[12]),
        syncState: String(parameters[13]),
        createdBy: String(parameters[14]),
      })
      return { rows: [this.stagedVersion] }
    }
    if (sql.includes('update matter_documents')) {
      this.requireLockedWrite()
      if (!this.stagedVersion) {
        throw new Error(
          'The version must be inserted before its pointer moves.',
        )
      }
      this.recordQuery(sql)
      requireSql(sql, 'current_version_id = $4')
      if (this.database.currentVersionId !== parameters[3]) return { rows: [] }
      this.stagedPointer = String(parameters[4])
      return { rows: [{ id: 'doc_1' }] }
    }
    if (
      sql.includes('insert into audit_logs') &&
      (parameters[4] === 'document.version_create' ||
        parameters[4] === 'document.edit' ||
        parameters[4] === 'document.collaboration_merge' ||
        parameters[4] === 'document.tracked_change_accept' ||
        parameters[4] === 'document.tracked_change_reject')
    ) {
      this.requireLockedWrite()
      this.recordQuery(sql)
      if (this.options.auditFailure) {
        throw new Error('private audit diagnostic')
      }
      const audit: Audit = {
        entityType: String(parameters[2]),
        entityId: String(parameters[3]),
        action: String(parameters[4]),
        metadata: JSON.parse(String(parameters[5])) as Record<string, unknown>,
      }
      Object.defineProperty(audit, 'userId', {
        value: String(parameters[1]),
      })
      this.stagedAudits.push(audit)
      return { rows: [] }
    }
    return this.sharedClient.query(sql, parameters)
  }

  release() {
    this.unlock()
    this.sharedClient.release()
  }

  private requireLockedWrite() {
    if (!this.lockChecked || !this.releaseLock) {
      throw new Error('Transaction writes require the locked base recheck.')
    }
  }

  private recordQuery(sql: string) {
    this.database.queries.push(sql)
  }

  private unlock() {
    this.releaseLock?.()
    this.releaseLock = null
  }
}

export class EditStorage extends SharedMemoryStorage {
  readonly writes: string[] = []
  writeFailure = false
  deleteFailure = false

  get reads() {
    return this.binaryReads
  }

  get readGate() {
    return this.binaryGate
  }

  set readGate(gate: Promise<void> | null) {
    this.binaryGate = gate
  }

  constructor() {
    super({ binary: [[sourceKey, sourceBytes]] })
  }

  override async writeBinary(key: string, contents: Buffer) {
    this.writes.push(key)
    await super.writeBinary(key, contents)
    if (this.writeFailure) throw new Error('private write diagnostic')
  }

  override async delete(key: string) {
    if (this.deleteFailure) throw new Error('private cleanup diagnostic')
    await super.delete(key)
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
  return {
    ...createRouteApp({
      database,
      storage,
      user,
      requestId: 'req_edit',
      createRoutes: createDocumentEditRoutes,
    }),
    storage,
  }
}

export function editRequest(
  baseVersionId = 'ver_1',
  text = 'Revised text',
  trackChanges = false,
) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersionId,
      operations: [{ type: 'replace_run_text', runId: editableRunId, text }],
      ...(trackChanges ? { trackChanges: true } : {}),
    }),
  }
}

function requireSql(sql: string, fragment: string) {
  if (!sql.includes(fragment)) {
    throw new Error(`Expected transaction SQL to contain ${fragment}.`)
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
    textObjectKey?: string | null
    failureReason?: string | null
    contentSha256?: string
    syncState?: string
    createdBy?: string
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
    failure_reason: options.failureReason ?? null,
    version_number: options.versionNumber ?? 1,
    content_sha256: options.contentSha256 ?? '0'.repeat(64),
    sync_state: options.syncState ?? 'synced',
    created_by: options.createdBy ?? 'usr_owner',
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
  }
}
