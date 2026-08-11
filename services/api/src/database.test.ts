import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  createDocument,
  createOrganisationForUser,
  restoreDocumentWithAudit,
  restoreMatterWithAudit,
  softDeleteMatterWithCascade,
} from './database'

type QueryCall = [string, unknown[] | undefined]

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    current_version_id: null,
    logical_key: 'doc_logical_1',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver_1',
    organisation_id: 'org_1',
    matter_id: 'mtr_1',
    matter_document_id: 'doc_1',
    filename: 'skeleton.pdf',
    file_type: 'application/pdf',
    size_bytes: '1234',
    object_key: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    text_object_key: null,
    document_status: 'queued',
    failure_reason: null,
    version_number: 1,
    content_sha256: 'a'.repeat(64),
    sync_state: 'synced',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function matterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mtr_1',
    organisation_id: 'org_1',
    name: 'Share purchase',
    description: null,
    primary_jurisdiction: 'england_and_wales',
    secondary_jurisdictions: [],
    legal_domains: ['corporate'],
    client_reference: '',
    status: 'active',
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

function createTransactionalPool(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
) {
  const calls: QueryCall[] = []
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push([sql, params])
      return query(sql, params)
    },
    release: () => undefined,
  } as unknown as PoolClient

  const pool = {
    connect: async () => client,
  } as unknown as Pool

  return { pool, calls }
}

describe('matter workspace database operations', () => {
  it('creates a logical document and initial immutable version in one transaction', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('select id from matters')) {
        return { rows: [{ id: 'mtr_1' }] }
      }
      if (sql.includes('insert into matter_documents')) {
        return { rows: [documentRow()] }
      }
      if (sql.includes('insert into document_versions')) {
        const params = calls.at(-1)?.[1] ?? []
        const versionId = String(params[0])
        return {
          rows: [
            versionRow({
              id: versionId,
              object_key: `org/org_1/matters/mtr_1/documents/doc_1/versions/${versionId}/source`,
            }),
          ],
        }
      }
      if (sql.includes('update matter_documents')) {
        const params = calls.at(-1)?.[1] ?? []
        return { rows: [documentRow({ current_version_id: params[2] })] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await createDocument(pool, {
      organisationId: 'org_1',
      matterId: 'mtr_1',
      userId: 'usr_1',
      filename: 'skeleton.pdf',
      fileType: 'application/pdf',
      sizeBytes: 1234,
      contentSha256: 'a'.repeat(64),
    })

    expect(
      calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    ).toEqual([
      'begin',
      'select id from',
      'insert into matter_documents',
      'insert into document_versions',
      'update matter_documents set',
      'commit',
    ])
    expect(result).not.toBeNull()
    if (!result) throw new Error('Expected document creation to succeed.')
    expect(result.document).toMatchObject({
      id: 'doc_1',
      currentVersionId: result.version.id,
    })
    expect(result.version).toMatchObject({
      matterDocumentId: 'doc_1',
      versionNumber: 1,
      documentStatus: 'queued',
      syncState: 'synced',
    })
    const parentLock = calls[1]
    expect(parentLock[0]).toContain('deleted_at is null')
    expect(parentLock[0]).toContain('for update')
    expect(parentLock[1]).toEqual(['mtr_1', 'org_1'])
    const versionParams = calls[3][1]
    expect(versionParams).toEqual([
      expect.stringMatching(/^ver_/),
      'org_1',
      'mtr_1',
      'doc_1',
      'skeleton.pdf',
      'application/pdf',
      1234,
      expect.stringMatching(
        /^org\/org_1\/matters\/mtr_1\/documents\/doc_1\/versions\/ver_.+\/source$/,
      ),
      null,
      'queued',
      null,
      1,
      'a'.repeat(64),
      'synced',
      'usr_1',
    ])
    expect(versionParams?.[7]).toBe(
      `org/org_1/matters/mtr_1/documents/doc_1/versions/${String(versionParams?.[0])}/source`,
    )
  })

  it('returns null before inserting when the parent matter is deleted', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('select id from matters')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createDocument(pool, {
        organisationId: 'org_1',
        matterId: 'mtr_1',
        userId: 'usr_1',
        filename: 'skeleton.pdf',
        fileType: 'application/pdf',
        sizeBytes: 1234,
        contentSha256: 'a'.repeat(64),
      }),
    ).resolves.toBeNull()

    expect(calls.some(([sql]) => sql.includes('insert into'))).toBe(false)
    expect(calls.map(([sql]) => sql)).toContain('rollback')
  })

  it('rolls back document creation when version creation fails', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('select id from matters')) {
        return { rows: [{ id: 'mtr_1' }] }
      }
      if (sql.includes('insert into matter_documents')) {
        return { rows: [documentRow()] }
      }
      if (sql.includes('insert into document_versions')) {
        throw new Error('version insert failed')
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createDocument(pool, {
        organisationId: 'org_1',
        matterId: 'mtr_1',
        userId: 'usr_1',
        filename: 'skeleton.pdf',
        fileType: 'application/pdf',
        sizeBytes: 1234,
        contentSha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow('version insert failed')

    expect(calls.map(([sql]) => sql)).toContain('rollback')
    expect(calls.map(([sql]) => sql)).not.toContain('commit')
  })

  it('soft-deletes a matter and cascades to documents and runs in one transaction', async () => {
    const deletedMatter = matterRow({
      status: 'deleted',
      deleted_at: '2026-02-01T00:00:00.000Z',
      deleted_by: 'usr_1',
    })
    const deletedDoc = documentRow({
      deleted_at: '2026-02-01T00:00:00.000Z',
      deleted_by: 'usr_1',
    })
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return { rows: [] }
      }
      if (text.includes('for update') && text.includes('deleted_at is null')) {
        return { rows: [{ id: 'mtr_1' }] }
      }
      if (text.startsWith('update matters')) {
        return { rows: [deletedMatter] }
      }
      if (text.startsWith('update matter_documents')) {
        return { rows: [deletedDoc] }
      }
      if (text.startsWith('update redaction_runs')) {
        return { rows: [{ id: 'red_1' }] }
      }
      if (text.includes('insert into audit_logs')) {
        return { rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await softDeleteMatterWithCascade(pool, {
      organisationId: 'org_1',
      userId: 'usr_1',
      id: 'mtr_1',
      requestId: 'req_1',
    })

    expect(result).not.toBeNull()
    expect(result?.matter).toMatchObject({
      id: 'mtr_1',
      status: 'deleted',
      deletedAt: '2026-02-01T00:00:00.000Z',
      deletedBy: 'usr_1',
    })
    expect(result?.documents).toHaveLength(1)
    expect(result?.runs).toEqual([{ id: 'red_1' }])
    // Lock, then cascade in order, then one audit row per deleted entity.
    expect(
      calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    ).toEqual([
      'begin',
      'select id from',
      'update matters set',
      'update matter_documents set',
      'update redaction_runs set',
      'insert into audit_logs',
      'insert into audit_logs',
      'insert into audit_logs',
      'commit',
    ])
    const auditActions = calls
      .filter(([sql]) => sql.includes('insert into audit_logs'))
      .map(([, params]) => (params as unknown[])[4])
    expect(auditActions).toEqual([
      'matter.delete',
      'document.delete',
      'redaction_run.delete',
    ])
  })

  it('returns null without auditing when the matter is already deleted', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'rollback') {
        return { rows: [] }
      }
      // FOR UPDATE finds no live row.
      if (text.includes('for update')) {
        return { rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await softDeleteMatterWithCascade(pool, {
      organisationId: 'org_1',
      userId: 'usr_1',
      id: 'mtr_1',
      requestId: 'req_1',
    })

    expect(result).toBeNull()
    expect(calls.some(([sql]) => sql.includes('insert into audit_logs'))).toBe(
      false,
    )
    expect(calls.map(([sql]) => sql)).toContain('rollback')
  })

  it('restores matters and writes the audit event in one transaction', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return { rows: [] }
      }
      if (
        text.includes('for update') &&
        text.includes('deleted_at is not null')
      ) {
        return { rows: [{ deleted_at: '2026-02-01T00:00:00.000Z' }] }
      }
      if (text.startsWith('update matters')) {
        return { rows: [matterRow()] }
      }
      if (
        text.startsWith('update matter_documents') ||
        text.startsWith('update redaction_runs')
      ) {
        // Cascade-restore matches deleted_at = T; none in this fixture.
        return { rows: [] }
      }
      if (text.includes('insert into audit_logs')) {
        return { rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const matter = await restoreMatterWithAudit(pool, {
      organisationId: 'org_1',
      userId: 'usr_1',
      id: 'mtr_1',
      requestId: 'req_1',
    })

    expect(matter).toMatchObject({
      id: 'mtr_1',
      organisationId: 'org_1',
      status: 'active',
      deletedAt: null,
    })
    // Lock parent, restore parent, (no children matched), one audit row, commit.
    expect(
      calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    ).toEqual([
      'begin',
      'select deleted_at::text from',
      'update matters set',
      'update matter_documents set',
      'update redaction_runs set',
      'insert into audit_logs',
      'commit',
    ])
    const auditCall = calls.find(([sql]) =>
      sql.includes('insert into audit_logs'),
    )
    expect(auditCall?.[1]).toEqual([
      'org_1',
      'usr_1',
      'matter',
      'mtr_1',
      'matter.restore',
      JSON.stringify({ documentCount: 0, runCount: 0 }),
      'req_1',
    ])
  })

  it('rolls back restore when the audit insert fails', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'rollback') {
        return { rows: [] }
      }
      if (text.includes('for update')) {
        return { rows: [{ deleted_at: '2026-02-01T00:00:00.000Z' }] }
      }
      if (text.startsWith('update matters')) {
        return { rows: [matterRow()] }
      }
      if (
        text.startsWith('update matter_documents') ||
        text.startsWith('update redaction_runs')
      ) {
        return { rows: [] }
      }
      if (text.includes('insert into audit_logs')) {
        throw new Error('audit insert failed')
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      restoreMatterWithAudit(pool, {
        organisationId: 'org_1',
        userId: 'usr_1',
        id: 'mtr_1',
        requestId: 'req_1',
      }),
    ).rejects.toThrow('audit insert failed')

    expect(calls.map(([sql]) => sql)).toContain('rollback')
    expect(calls.map(([sql]) => sql)).not.toContain('commit')
  })

  it('cascade-restore matches children by the parent deleted_at timestamp (provenance)', async () => {
    // Provenance rule: only children whose deleted_at equals the parent's
    // deleted_at are revived. An individually-deleted child (different
    // timestamp) must stay deleted. The mock returns the parent timestamp T;
    // the child UPDATE must predicate on that exact value ($3 = T).
    const parentDeletedAt = '2026-02-01T00:00:00.000Z'
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return { rows: [] }
      }
      if (
        text.includes('for update') &&
        text.includes('deleted_at is not null')
      ) {
        return { rows: [{ deleted_at: parentDeletedAt }] }
      }
      if (text.startsWith('update matters')) {
        return { rows: [matterRow()] }
      }
      return { rows: [] }
    })

    await restoreMatterWithAudit(pool, {
      organisationId: 'org_1',
      userId: 'usr_1',
      id: 'mtr_1',
      requestId: 'req_1',
    })

    const lock = calls.find(([sql]) => sql.includes('for update'))
    const docRestore = calls.find(([sql]) =>
      sql.includes('update matter_documents'),
    )
    const runRestore = calls.find(([sql]) =>
      sql.includes('update redaction_runs'),
    )
    // The child restore predicates on the parent's deleted_at (param $3),
    // NOT a blanket "deleted_at is not null" — that is the provenance rule.
    expect(docRestore?.[0]).toMatch(/deleted_at = \$3::timestamptz/)
    expect(docRestore?.[0]).not.toMatch(/deleted_at is not null/)
    expect(docRestore?.[1]?.[2]).toBe(parentDeletedAt)
    expect(runRestore?.[0]).toMatch(/deleted_at = \$3::timestamptz/)
    expect(runRestore?.[0]).toContain('document.deleted_at is null')
    expect(runRestore?.[0]).toContain('document_id is null')
    expect(runRestore?.[1]?.[2]).toBe(parentDeletedAt)
    // Precision guard: the lock selects deleted_at::text so the timestamp can
    // round-trip with full microsecond fidelity. Selecting it as a Date would
    // drop microseconds and the equality match would silently match 0 rows.
    expect(lock?.[0]).toMatch(/deleted_at::text/)
  })

  it('restores a document and only runs with the same deletion timestamp', async () => {
    const deletedAt = '2026-02-01 00:00:00.123456+00'
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'commit') return { rows: [] }
      if (text.startsWith('select matter_id from matter_documents')) {
        return { rows: [{ matter_id: 'mtr_1' }] }
      }
      if (text.startsWith('select id from matters')) {
        return { rows: [{ id: 'mtr_1' }] }
      }
      if (text.startsWith('select deleted_at::text from matter_documents')) {
        return { rows: [{ deleted_at: deletedAt }] }
      }
      if (text.startsWith('update matter_documents')) {
        return { rows: [documentRow()] }
      }
      if (text.startsWith('update redaction_runs')) {
        return { rows: [{ id: 'red_1' }] }
      }
      if (text.includes('insert into audit_logs')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await restoreDocumentWithAudit(pool, {
      organisationId: 'org_1',
      userId: 'usr_1',
      id: 'doc_1',
      requestId: 'req_1',
    })

    expect(result).toMatchObject({
      document: { id: 'doc_1', deletedAt: null },
      runs: [{ id: 'red_1' }],
    })
    const documentRestore = calls.find(([sql]) =>
      sql.includes('update matter_documents'),
    )
    const runRestore = calls.find(([sql]) =>
      sql.includes('update redaction_runs'),
    )
    expect(documentRestore?.[0]).toContain('deleted_at = $3::timestamptz')
    expect(documentRestore?.[1]?.[2]).toBe(deletedAt)
    expect(runRestore?.[0]).toContain('deleted_at = $3::timestamptz')
    expect(runRestore?.[1]?.[2]).toBe(deletedAt)
    const auditActions = calls
      .filter(([sql]) => sql.includes('insert into audit_logs'))
      .map(([, params]) => params?.[4])
    expect(auditActions).toEqual(['document.restore', 'redaction_run.restore'])
  })
})

describe('createOrganisationForUser', () => {
  it('fails closed and rolls back when the user row is missing (no orphan org/audit)', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      // SELECT ... FOR UPDATE returns zero rows — the user does not exist.
      if (sql.includes('select "organisationId"')) {
        return { rows: [] }
      }
      if (sql.includes('insert into organisations')) {
        return {
          rows: [{ id: 'org_orphan', name: 'Orphan', plan: 'private_beta' }],
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createOrganisationForUser(pool, {
        userId: 'usr_missing',
        name: 'Acme',
        requestId: 'req_1',
      }),
    ).rejects.toThrow('User record not found.')

    const sequence = calls.map(([sql]) => sql)
    expect(sequence).toContain('rollback')
    expect(sequence).not.toContain('commit')
    // Must not have created an orphan organisation or audit row.
    expect(sequence.some((s) => s.includes('insert into organisations'))).toBe(
      false,
    )
    expect(sequence.some((s) => s.includes('insert into audit_logs'))).toBe(
      false,
    )
  })

  it('returns created:false when the user already has an organisation', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('select "organisationId"')) {
        return { rows: [{ organisationId: 'org_existing', role: 'member' }] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createOrganisationForUser(pool, {
        userId: 'usr_1',
        name: 'Acme',
        requestId: 'req_1',
      }),
    ).resolves.toEqual({
      created: false,
      organisationId: 'org_existing',
      role: 'member',
    })

    const sequence = calls.map(([sql]) => sql)
    expect(sequence).toContain('rollback')
    expect(sequence).not.toContain('commit')
    expect(sequence.some((s) => s.includes('insert into organisations'))).toBe(
      false,
    )
  })
})
