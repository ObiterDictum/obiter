import type { Pool } from 'pg'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { StorageService } from './storage'


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

const verificationChecksKeys = Object.fromEntries(
  Object.keys(await import('./verification-checks')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./verification-checks', () =>
  Object.assign(
    { ...verificationChecksKeys },
    {
      collectVerificationFindings: mocks.collectVerificationFindings,
    },
  ),
)

const documentModelStoreKeys = Object.fromEntries(
  Object.keys(await import('./document-model-store')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./document-model-store', () =>
  Object.assign(
    { ...documentModelStoreKeys },
    {
      getDocumentModel: mocks.getDocumentModel,
      DocumentModelStoreError: class DocumentModelStoreError extends Error {},
    },
  ),
)

const verificationExtractionKeys = Object.fromEntries(
  Object.keys(await import('./verification-extraction')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./verification-extraction', () =>
  Object.assign(
    { ...verificationExtractionKeys },
    {
      extractVerificationCandidates: mocks.extractVerificationCandidates,
      VerificationExtractionLimitError: class VerificationExtractionLimitError extends Error {},
    },
  ),
)

const { createAndExecuteVerificationRun } =
  await import('./verification-execution')

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

function asPool(query: StubQuery): Pool {
  const connect = async () => ({ query, release: () => {} })
  return { query, connect } as unknown as Pool
}

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
    if (text.includes('insert into verification_runs')) {
      return { rows: [{ id: values?.[0] }] }
    }
    if (text.includes('update verification_runs')) {
      return { rows: [], rowCount: 1 }
    }
    return { rows: [] }
  }

  return asPool(query)
}

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

    expect(mocks.collectVerificationFindings).toHaveBeenCalledTimes(1)
    expect(mocks.collectVerificationFindings.mock.calls[0]?.[0]).toBe(corpus)

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

    expect(mocks.collectVerificationFindings.mock.calls[0]?.[0]).toBe(
      application,
    )
  })
})
