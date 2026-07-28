import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  finalizeRedactionRun,
  getDocumentRedactionSource,
  listRedactionAuditLog,
  recordSpanDecision,
  restoreRedactionRunWithAudit,
} from './redaction-database'
import {
  createRedactionRun,
  createRedetectionRun,
} from './redaction-run-creation'

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
    detection_mode: 'model+supplement',
    replaces_run_id: null,
    replacement_run_id: null,
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

describe('createRedactionRun', () => {
  it('persists and returns the structured detection mode', async () => {
    const queries: QueryCall[] = []
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push([sql, params])
        return {
          rows: [
            runRow({
              spans_json: [],
              detection_mode: 'heuristics+supplement',
            }),
          ],
        }
      },
    } as unknown as Pool

    const created = await createRedactionRun({
      pool,
      id: 'red_1',
      organisationId: 'org_1',
      userId: 'usr_1',
      sourceFilename: 'source.txt',
      sourceTextObjectKey: 'org/org_1/redaction-runs/red_1/source',
      spans: [],
      detectorVersion: 'detector-1;mode=heuristics+supplement',
      detectionMode: 'heuristics+supplement',
      policyMode: 'internal_ai_minimisation',
    })

    expect(created?.detectionMode).toBe('heuristics+supplement')
    expect(queries[0][0]).toContain('detection_mode')
    expect(queries[0][1]?.[11]).toBe('heuristics+supplement')
  })
})

describe('createRedetectionRun', () => {
  it('creates a fresh standalone run and links both audit histories atomically', async () => {
    const { pool, calls } = createTransactionalPool(async (sql, params) => {
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes('for update of run')) {
        return {
          rows: [runRow({ detection_mode: 'heuristics+supplement' })],
        }
      }
      if (sql.includes('run.replaces_run_id')) return { rows: [] }
      if (sql.includes('insert into redaction_runs')) {
        return {
          rows: [
            runRow({
              id: 'red_2',
              source_text_object_key: 'org/org_1/redaction-runs/red_2/source',
              detection_mode: 'model+supplement',
              replaces_run_id: 'red_1',
              spans_json: [],
            }),
          ],
        }
      }
      if (sql.includes('insert into audit_logs')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql} ${String(params)}`)
    })

    const result = await createRedetectionRun({
      pool,
      organisationId: 'org_1',
      userId: 'usr_1',
      sourceRunId: 'red_1',
      newRunId: 'red_2',
      sourceTextObjectKey: 'org/org_1/redaction-runs/red_2/source',
      spans: [],
      detectorVersion: 'detector-2;mode=model+supplement',
      detectionMode: 'model+supplement',
      requestId: 'req_1',
    })

    expect(result).toMatchObject({
      kind: 'created',
      run: { id: 'red_2', replacesRunId: 'red_1' },
    })
    const insert = calls.find(([sql]) =>
      sql.includes('insert into redaction_runs'),
    )
    expect(insert?.[1]?.[12]).toBe('red_1')
    expect(
      calls.filter(([sql]) => sql.includes('insert into audit_logs')),
    ).toHaveLength(2)
    expect(calls.at(-1)?.[0]).toBe('commit')
  })

  it.each([1, 2])(
    'rolls the replacement and both audit events back when audit write %s fails',
    async (failingAudit) => {
      let auditWrites = 0
      const { pool, calls } = createTransactionalPool(async (sql) => {
        if (sql === 'begin' || sql === 'rollback') return { rows: [] }
        if (sql.includes('for update of run')) {
          return {
            rows: [runRow({ detection_mode: 'heuristics+supplement' })],
          }
        }
        if (sql.includes('run.replaces_run_id')) return { rows: [] }
        if (sql.includes('insert into redaction_runs')) {
          return {
            rows: [
              runRow({
                id: 'red_2',
                detection_mode: 'model+supplement',
                replaces_run_id: 'red_1',
              }),
            ],
          }
        }
        if (sql.includes('insert into audit_logs')) {
          auditWrites += 1
          if (auditWrites === failingAudit) throw new Error('audit unavailable')
          return { rows: [] }
        }
        throw new Error(`Unexpected SQL: ${sql}`)
      })

      await expect(
        createRedetectionRun({
          pool,
          organisationId: 'org_1',
          userId: 'usr_1',
          sourceRunId: 'red_1',
          newRunId: 'red_2',
          sourceTextObjectKey: 'org/org_1/redaction-runs/red_2/source',
          spans: [],
          detectorVersion: 'detector-2;mode=model+supplement',
          detectionMode: 'model+supplement',
          requestId: 'req_1',
        }),
      ).rejects.toThrow('audit unavailable')

      expect(calls.some(([sql]) => sql === 'commit')).toBe(false)
      expect(calls.at(-1)?.[0]).toBe('rollback')
    },
  )

  it('returns an existing live replacement without inserting another run', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) {
        return {
          rows: [runRow({ detection_mode: 'heuristics+supplement' })],
        }
      }
      if (sql.includes('run.replaces_run_id')) {
        return {
          rows: [runRow({ id: 'red_2', replaces_run_id: 'red_1' })],
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await createRedetectionRun({
      pool,
      organisationId: 'org_1',
      userId: 'usr_1',
      sourceRunId: 'red_1',
      newRunId: 'red_3',
      sourceTextObjectKey: 'org/org_1/redaction-runs/red_3/source',
      spans: [],
      detectorVersion: 'detector-2;mode=model+supplement',
      detectionMode: 'model+supplement',
      requestId: 'req_1',
    })

    expect(result).toMatchObject({ kind: 'existing', run: { id: 'red_2' } })
    expect(
      calls.some(([sql]) => sql.includes('insert into redaction_runs')),
    ).toBe(false)
    expect(calls.at(-1)?.[0]).toBe('rollback')
  })

  it('validates the original linked version without requiring it to remain current', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes('for update of run')) {
        return {
          rows: [
            runRow({
              matter_id: 'mtr_1',
              document_id: 'doc_1',
              document_version_id: 'ver_old',
              source_text_object_key: null,
              detection_mode: 'heuristics+supplement',
            }),
          ],
        }
      }
      if (sql.includes('run.replaces_run_id')) return { rows: [] }
      if (sql.includes('from matter_documents document')) {
        return { rows: [{ id: 'ver_old' }] }
      }
      if (sql.includes('insert into redaction_runs')) {
        return {
          rows: [
            runRow({
              id: 'red_2',
              matter_id: 'mtr_1',
              document_id: 'doc_1',
              document_version_id: 'ver_old',
              source_text_object_key: null,
              replaces_run_id: 'red_1',
            }),
          ],
        }
      }
      if (sql.includes('insert into audit_logs')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(
      createRedetectionRun({
        pool,
        organisationId: 'org_1',
        userId: 'usr_1',
        sourceRunId: 'red_1',
        newRunId: 'red_2',
        sourceTextObjectKey: null,
        spans: [],
        detectorVersion: 'detector-2;mode=model+supplement',
        detectionMode: 'model+supplement',
        requestId: 'req_1',
      }),
    ).resolves.toMatchObject({ kind: 'created' })

    const parentCheck = calls.find(([sql]) =>
      sql.includes('from matter_documents document'),
    )
    expect(parentCheck?.[0]).not.toContain('current_version_id')
    expect(parentCheck?.[1]).toEqual(['doc_1', 'org_1', 'mtr_1', 'ver_old'])
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
        userId: 'usr_1',
        requestId: 'req_1',
        degradedDetectionAcknowledged: false,
        unknownDetectionAcknowledged: false,
      }),
    ).resolves.toEqual({ kind: 'not_found' })

    const lock = calls.find(([sql]) => sql.includes('for update of run'))
    expect(lock?.[0]).toContain('run.deleted_at is null')
    expect(calls.some(([sql]) => sql.includes('insert into artifacts'))).toBe(
      false,
    )
  })

  it('refuses to finalize a run after a live replacement exists', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) {
        return { rows: [runRow({ replacement_run_id: 'red_2' })] }
      }
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
        userId: 'usr_1',
        requestId: 'req_1',
        degradedDetectionAcknowledged: false,
        unknownDetectionAcknowledged: false,
      }),
    ).resolves.toEqual({ kind: 'replaced', replacementRunId: 'red_2' })

    expect(calls.some(([sql]) => sql.includes('insert into artifacts'))).toBe(
      false,
    )
  })

  it('rechecks degraded acknowledgement under the finalization row lock', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) {
        return {
          rows: [runRow({ detection_mode: 'heuristics+supplement' })],
        }
      }
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
        userId: 'usr_1',
        requestId: 'req_1',
        degradedDetectionAcknowledged: false,
        unknownDetectionAcknowledged: false,
      }),
    ).resolves.toEqual({ kind: 'acknowledgement_required' })

    expect(calls.some(([sql]) => sql.includes('insert into artifacts'))).toBe(
      false,
    )
  })

  it('rechecks unknown-mode acknowledgement under the finalization row lock', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
      if (sql.includes('for update of run')) {
        return { rows: [runRow({ detection_mode: 'unknown' })] }
      }
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
        userId: 'usr_1',
        requestId: 'req_1',
        degradedDetectionAcknowledged: false,
        unknownDetectionAcknowledged: false,
      }),
    ).resolves.toEqual({ kind: 'acknowledgement_required' })

    expect(calls.some(([sql]) => sql.includes('insert into artifacts'))).toBe(
      false,
    )
  })

  it('rolls finalization back when its audit write fails', async () => {
    const { pool, calls } = createTransactionalPool(async (sql) => {
      if (sql === 'begin' || sql === 'rollback') return { rows: [] }
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
      if (sql.includes('insert into audit_logs')) {
        throw new Error('audit unavailable')
      }
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
        userId: 'usr_1',
        requestId: 'req_1',
        degradedDetectionAcknowledged: false,
        unknownDetectionAcknowledged: false,
      }),
    ).rejects.toThrow('audit unavailable')

    expect(calls.some(([sql]) => sql === 'commit')).toBe(false)
    expect(calls.some(([sql]) => sql === 'rollback')).toBe(true)
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
      if (sql.includes('insert into audit_logs')) return { rows: [] }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await finalizeRedactionRun({
      pool,
      organisationId: 'org_1',
      runId: 'red_1',
      outputMode: 'redacted',
      tokenMap: {},
      artifactId: 'art_1',
      userId: 'usr_1',
      requestId: 'req_1',
      degradedDetectionAcknowledged: false,
      unknownDetectionAcknowledged: false,
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
        detectionMode: 'model+supplement',
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
