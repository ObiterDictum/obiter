import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  createRedactionRun,
  finalizeRedactionRun,
  getDocumentRedactionSource,
  listRedactionAuditLog,
  recordSpanDecision,
  restoreRedactionRunWithAudit,
} from './redaction-database'

type QueryCall = [string, unknown[] | undefined]

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'red_1',
    organisation_id: 'org_1',
    matter_id: null,
    matter_name: null,
    document_id: null,
    document_version_id: null,
    source_filename: 'source.txt',
    source_text_object_key: 'org/org_1/redaction-runs/red_1/source',
    status: 'ready_for_review',
    policy_mode: 'internal_ai_minimisation',
    spans_json: [
      {
        id: 'span_1',
        start: 0,
        end: 4,
        text: 'Jane',
        category: 'person_name',
        source: 'rampart_model',
        confidence: 'high',
        suggestion: 'redact',
      },
    ],
    decisions_json: {},
    output_artifact_id: null,
    summary_json: {},
    detector_version: 'detector-1',
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
  const pool = { connect: async () => client } as unknown as Pool
  return { pool, calls }
}

describe('listRedactionAuditLog', () => {
  it('scopes run audit reads by organisation, excluding nullable auth audit rows', async () => {
    const queries: unknown[][] = []
    const pool = {
      query: async (...args: unknown[]) => {
        queries.push(args)
        return {
          rows: [
            {
              action: 'redaction.finalize',
              user_id: 'usr_1',
              created_at: '2026-01-01T00:00:00.000Z',
              metadata_json: {},
            },
          ],
        }
      },
    } as never
    await expect(
      listRedactionAuditLog(pool, 'org_1', 'red_1'),
    ).resolves.toEqual([
      {
        action: 'redaction.finalize',
        userId: 'usr_1',
        timestamp: '2026-01-01T00:00:00.000Z',
        details: {},
      },
    ])
    expect(String(queries[0][0])).toContain('organisation_id = $1')
    expect(queries[0][1]).toEqual(['org_1', 'red_1'])
  })
})

describe('getDocumentRedactionSource', () => {
  it('includes the organisation scope when resolving a document for a new run', async () => {
    const queries: unknown[][] = []
    const pool = {
      query: async (...args: unknown[]) => {
        queries.push(args)
        return { rows: [] }
      },
    } as never

    await expect(
      getDocumentRedactionSource(pool, 'org_1', 'doc_from_org_2'),
    ).resolves.toBeNull()

    expect(String(queries[0][0])).toContain('document.organisation_id = $2')
    expect(queries[0][1]).toEqual(['doc_from_org_2', 'org_1'])
  })
})

describe('redaction run write guards', () => {
  it('treats a soft-deleted run as not found when recording a decision', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      recordSpanDecision({
        pool,
        organisationId: 'org_1',
        runId: 'red_1',
        spanId: 'span_1',
        decision: 'accept',
        userId: 'usr_1',
      }),
    ).resolves.toEqual({ kind: 'not_found' })

    const lock = calls.find(([sql]) => sql.includes('for update of run'))
    expect(lock?.[0]).toContain('run.deleted_at is null')
    expect(calls.some(([sql]) => sql.includes('update redaction_runs'))).toBe(
      false,
    )
  })

  it('treats a soft-deleted run as not found before finalization creates an artifact', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      finalizeRedactionRun({
        pool,
        organisationId: 'org_1',
        runId: 'red_1',
        outputMode: 'redacted',
        tokenMap: {},
        artifactId: 'art_1',
      }),
    ).resolves.toEqual({ kind: 'not_found' })

    const lock = calls.find(([sql]) => sql.includes('for update of run'))
    expect(lock?.[0]).toContain('run.deleted_at is null')
    expect(calls.some(([sql]) => sql.includes('insert into artifacts'))).toBe(
      false,
    )
  })

  it('returns deletion columns after recording a decision', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes('for update of run')) return { rows: [runRow()] }
      if (sql.includes('update redaction_runs')) {
        return { rows: [runRow({ status: 'reviewing' })] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await recordSpanDecision({
      pool,
      organisationId: 'org_1',
      runId: 'red_1',
      spanId: 'span_1',
      decision: 'accept',
      userId: 'usr_1',
    })

    expect(result.kind).toBe('updated')
    const update = calls.find(([sql]) => sql.includes('update redaction_runs'))
    expect(update?.[0]).toMatch(/returning[\s\S]*deleted_at/)
    expect(update?.[0]).toMatch(/returning[\s\S]*deleted_by/)
  })

  it('returns deletion columns after finalizing a run', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes('for update of run')) return { rows: [runRow()] }
      if (sql.includes('insert into artifacts')) {
        return {
          rows: [{ id: 'art_1', object_key: 'org/org_1/artifacts/art_1' }],
        }
      }
      if (sql.includes('update redaction_runs')) {
        return {
          rows: [runRow({ status: 'finalized', output_artifact_id: 'art_1' })],
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await finalizeRedactionRun({
      pool,
      organisationId: 'org_1',
      runId: 'red_1',
      outputMode: 'redacted',
      tokenMap: {},
      artifactId: 'art_1',
    })

    expect(result.kind).toBe('finalized')
    const update = calls.find(([sql]) => sql.includes('update redaction_runs'))
    expect(update?.[0]).toMatch(/returning[\s\S]*deleted_at/)
    expect(update?.[0]).toMatch(/returning[\s\S]*deleted_by/)
  })

  it('does not create a linked run when its document or matter is deleted', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('select id from matters')) {
        return { rows: [{ id: 'mtr_1' }] }
      }
      if (sql.includes('select id from matter_documents')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createRedactionRun({
        pool,
        id: 'red_1',
        organisationId: 'org_1',
        userId: 'usr_1',
        sourceFilename: 'source.txt',
        sourceTextObjectKey: null,
        spans: [],
        detectorVersion: 'detector-1',
        policyMode: 'internal_ai_minimisation',
        matterId: 'mtr_1',
        documentId: 'doc_1',
        documentVersionId: 'ver_1',
      }),
    ).resolves.toBeNull()

    const matterLock = calls.find(([sql]) =>
      sql.includes('select id from matters'),
    )
    const documentLock = calls.find(([sql]) =>
      sql.includes('select id from matter_documents'),
    )
    expect(matterLock?.[0]).toContain('deleted_at is null')
    expect(matterLock?.[0]).toContain('for update')
    expect(documentLock?.[0]).toContain('deleted_at is null')
    expect(documentLock?.[0]).toContain('for update')
    expect(
      calls.some(([sql]) => sql.includes('insert into redaction_runs')),
    ).toBe(false)
  })
})

describe('restoreRedactionRunWithAudit', () => {
  it('uses timestamp provenance and writes the restore audit row', async () => {
    const deletedAt = '2026-02-01 00:00:00.123456+00'
    const { pool, calls } = createTransactionalPool(async (sql) => {
      const text = sql.trim()
      if (text === 'begin' || text === 'commit') return { rows: [] }
      if (text.startsWith('select matter_id, document_id')) {
        return { rows: [{ matter_id: null, document_id: null }] }
      }
      if (text.startsWith('select deleted_at::text')) {
        return { rows: [{ deleted_at: deletedAt }] }
      }
      if (text.startsWith('update redaction_runs')) return { rows: [runRow()] }
      if (text.includes('insert into audit_logs')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      restoreRedactionRunWithAudit(pool, {
        organisationId: 'org_1',
        userId: 'usr_1',
        runId: 'red_1',
        requestId: 'req_1',
      }),
    ).resolves.toMatchObject({ id: 'red_1', deletedAt: null })

    const update = calls.find(([sql]) => sql.includes('update redaction_runs'))
    expect(update?.[0]).toContain('deleted_at = $3::timestamptz')
    expect(update?.[1]?.[2]).toBe(deletedAt)
    const audit = calls.find(([sql]) => sql.includes('insert into audit_logs'))
    expect(audit?.[1]?.[4]).toBe('redaction_run.restore')
  })
})
