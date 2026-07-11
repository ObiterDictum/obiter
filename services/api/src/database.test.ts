import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  createDocument,
  createOrganisationForUser,
  restoreMatterWithAudit,
  softDeleteMatter,
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
    ...overrides,
  }
}

function createTransactionalPool(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
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

    expect(calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'begin',
      'insert into matter_documents',
      'insert into document_versions',
      'update matter_documents set',
      'commit',
    ])
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
    const versionParams = calls[2][1]
    expect(versionParams).toEqual([
      expect.stringMatching(/^ver_/),
      'org_1',
      'mtr_1',
      'doc_1',
      'skeleton.pdf',
      'application/pdf',
      1234,
      expect.stringMatching(/^org\/org_1\/matters\/mtr_1\/documents\/doc_1\/versions\/ver_.+\/source$/),
      'a'.repeat(64),
      'synced',
      'usr_1',
    ])
    expect(versionParams?.[7]).toBe(
      `org/org_1/matters/mtr_1/documents/doc_1/versions/${String(versionParams?.[0])}/source`,
    )
  })

  it('rolls back document creation when version creation fails', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
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

  it('soft deletes matters by setting deleted status and deleted_at in organisation scope', async () => {
    const calls: QueryCall[] = []
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push([sql, params])
        return {
          rows: [
            {
              id: 'mtr_1',
              organisation_id: 'org_1',
              name: 'Share purchase',
              description: null,
              primary_jurisdiction: 'england_and_wales',
              secondary_jurisdictions: [],
              legal_domains: ['corporate'],
              client_reference: '',
              status: 'deleted',
              created_by: 'usr_1',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              deleted_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      },
    } as unknown as Pool

    const matter = await softDeleteMatter(pool, 'org_1', 'mtr_1')

    expect(matter).toMatchObject({
      id: 'mtr_1',
      organisationId: 'org_1',
      status: 'deleted',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(calls[0]).toEqual([
      expect.stringContaining("set status = 'deleted', deleted_at = now()"),
      ['mtr_1', 'org_1'],
    ])
  })

  it('restores matters and writes the audit event in one transaction', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('update matters')) {
        return { rows: [matterRow()] }
      }
      if (sql.includes('insert into audit_logs')) {
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

    expect(calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'begin',
      'update matters set',
      'insert into audit_logs',
      'commit',
    ])
    expect(matter).toMatchObject({
      id: 'mtr_1',
      organisationId: 'org_1',
      status: 'active',
      deletedAt: null,
    })
    expect(calls[2]).toEqual([
      expect.stringContaining('insert into audit_logs'),
      ['org_1', 'usr_1', 'matter', 'mtr_1', 'matter.restore', '{}', 'req_1'],
    ])
  })

  it('rolls back restore when the audit insert fails', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('update matters')) {
        return { rows: [matterRow()] }
      }
      if (sql.includes('insert into audit_logs')) {
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
})

describe('createOrganisationForUser', () => {
  it('fails closed and rolls back when the user row is missing (no orphan org/audit)', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      // SELECT ... FOR UPDATE returns zero rows — the user does not exist.
      if (sql.includes('select "organisationId" from users')) {
        return { rows: [] }
      }
      if (sql.includes('insert into organisations')) {
        return { rows: [{ id: 'org_orphan', name: 'Orphan', plan: 'private_beta' }] }
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
    expect(sequence.some((s) => s.includes('insert into organisations'))).toBe(false)
    expect(sequence.some((s) => s.includes('insert into audit_logs'))).toBe(false)
  })

  it('returns created:false when the user already has an organisation', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') {
        return { rows: [] }
      }
      if (sql.includes('select "organisationId" from users')) {
        return { rows: [{ organisationId: 'org_existing' }] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createOrganisationForUser(pool, {
        userId: 'usr_1',
        name: 'Acme',
        requestId: 'req_1',
      }),
    ).resolves.toEqual({ created: false })

    const sequence = calls.map(([sql]) => sql)
    expect(sequence).toContain('rollback')
    expect(sequence).not.toContain('commit')
    expect(sequence.some((s) => s.includes('insert into organisations'))).toBe(false)
  })
})
