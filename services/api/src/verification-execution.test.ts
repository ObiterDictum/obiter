import type { Pool } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageService } from './storage'

/**
 * The verification corpus seam. A run reads the legal corpus and writes a run,
 * its findings and an audit row. Those are two different databases in the
 * configuration this seam exists for, so the test asserts which pool each side
 * uses rather than trusting the reading.
 */

const mocks = vi.hoisted(() => ({
  collectVerificationFindings: vi.fn(
    async (_pool: unknown, ..._rest: unknown[]) => [] as unknown[],
  ),
  getDocumentModel: vi.fn(async () => ({})),
  extractVerificationCandidates: vi.fn(() => ({
    citations: [],
    quotes: [],
  })),
}))

vi.mock('./verification-checks', () => ({
  collectVerificationFindings: mocks.collectVerificationFindings,
}))

vi.mock('./document-model-store', () => ({
  getDocumentModel: mocks.getDocumentModel,
  DocumentModelStoreError: class DocumentModelStoreError extends Error {},
}))

vi.mock('./verification-extraction', () => ({
  extractVerificationCandidates: mocks.extractVerificationCandidates,
  VerificationExtractionLimitError: class VerificationExtractionLimitError extends Error {},
}))

import { createAndExecuteVerificationRun } from './verification-execution'

const storage = {} as unknown as StorageService

const user = { id: 'usr_1', organisationId: 'org_1', role: 'owner' } as const

function statement(text: string) {
  return text.trim().split('\n')[0]!.trim().toLowerCase()
}

interface StubStatement {
  rows: unknown[]
  rowCount?: number
}

type StubQuery = (text: string, values?: unknown[]) => Promise<StubStatement>

/**
 * `pg`'s `Pool.query` is overloaded across streams, config objects and plain
 * SQL, so a stub cannot be structurally assigned to it. These stubs implement
 * the one call shape the seam uses — a SQL string with optional values — and are
 * asserted into the pool shape for that reason.
 */
function asPool(query: StubQuery): Pool {
  const connect = async () => ({ query, release: () => {} })
  return { query, connect } as unknown as Pool
}

/** Records every statement it is asked to run, and answers the run's own SQL. */
function recordingPool(seen: string[]) {
  const query: StubQuery = async (text, values) => {
    seen.push(statement(text))

    if (text.includes('for update')) {
      return {
        rows: [
          {
            matter_id: 'mtr_1',
            document_id: 'doc_1',
            version_id: 'ver_1',
            object_key: 'object-key',
            document_status: 'ready',
          },
        ],
      }
    }
    // The run id comes back from the insert's `returning id`.
    if (text.includes('insert into verification_runs')) {
      return { rows: [{ id: values?.[0] }] }
    }
    // Completion reports success through the row count, and a run treated as
    // reclaimed stops before the finding and audit writes.
    if (text.includes('update verification_runs')) {
      return { rows: [], rowCount: 1 }
    }
    return { rows: [] }
  }

  return asPool(query)
}

/**
 * Fails loudly on any use at all. The corpus read is mocked, so the corpus pool
 * should receive nothing here: a statement reaching it means the run reached
 * for the corpus database for something that is not a corpus read.
 */
function forbiddenPool() {
  const refuse: StubQuery = async (text) => {
    throw new Error(`corpus pool used for: ${statement(text)}`)
  }
  return asPool(refuse)
}

describe('verification run corpus seam', () => {
  beforeEach(() => {
    mocks.collectVerificationFindings.mockClear()
    mocks.getDocumentModel.mockClear()
    mocks.extractVerificationCandidates.mockClear()
  })

  it('reads the corpus through the corpus pool and writes the run to the application pool', async () => {
    const applicationSeen: string[] = []
    const application = recordingPool(applicationSeen)
    const corpus = forbiddenPool()

    const result = await createAndExecuteVerificationRun({
      pool: application,
      corpusPool: corpus,
      storage,
      user: { ...user },
      documentId: 'doc_1',
      versionId: 'ver_1',
      requestId: 'req_seam',
    })

    expect(result).toEqual({ ok: true, runId: expect.any(String) })

    // The corpus read is the one call that goes through the corpus seam.
    expect(mocks.collectVerificationFindings).toHaveBeenCalledTimes(1)
    expect(mocks.collectVerificationFindings.mock.calls[0]?.[0]).toBe(corpus)

    // Every statement the run issued went to the application database, and the
    // run, finding and audit writes are among them.
    const issued = applicationSeen.join('\n')
    expect(applicationSeen.length).toBeGreaterThan(0)
    expect(issued).not.toMatch(/legal_source_documents|legislation_/)
    expect(issued).toMatch(/verification_runs/)
    expect(issued).toMatch(/verification_findings/)
    expect(issued).toMatch(/audit_logs/)
  })

  it('uses the application pool for the corpus read when none is configured', async () => {
    const applicationSeen: string[] = []
    const application = recordingPool(applicationSeen)

    await createAndExecuteVerificationRun({
      pool: application,
      corpusPool: application,
      storage,
      user: { ...user },
      documentId: 'doc_1',
      versionId: 'ver_1',
      requestId: 'req_seam_default',
    })

    // The compatibility configuration: one pool, and the read still goes
    // through the seam rather than around it.
    expect(mocks.collectVerificationFindings.mock.calls[0]?.[0]).toBe(
      application,
    )
  })
})
