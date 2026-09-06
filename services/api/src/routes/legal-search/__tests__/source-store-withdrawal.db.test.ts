import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresLegalAuthoritySourceStore } from '../source-store'

/**
 * Withdrawal surfacing against the real Postgres store: a row marked
 * withdrawn (the checker writes provider_json.withdrawn, simulated here with
 * the same merge) disappears from default search and reports its flag on
 * get, while untouched rows keep serving. Requires TEST_DATABASE_URL.
 */

const documentId = 'db-test-withdrawn-2026-1'

const authority = {
  id: documentId,
  title: 'Withdrawn Test Judgment Concerning Fiduciary Appendix',
  neutralCitation: null,
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2026-01-15',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2026/1',
  paragraphs: [
    {
      id: `${documentId}-p1`,
      documentId,
      paragraphNumber: 1,
      text: 'The fiduciary appendix sets out the duties owed in this withdrawn test judgment.',
    },
  ],
}

const provider = {
  documentUri: '/uksc/2026/1',
  sourceUri: '/uksc/2026/1',
  xmlUri: '/uksc/2026/1/data.xml',
  pdfUri: null,
  contentHash: 'dbtest123',
  rawAtomEntry: '<entry />',
}

const withdrawn = {
  at: '2026-09-01T00:00:00.000Z',
  checkedUris: ['/uksc/2026/1', '/uksc/2026/1/data.xml'],
  runIds: ['run-0', 'run-1'],
}

describe('postgres legal authority source store withdrawals', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for source-store-withdrawal.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })
  const store = createPostgresLegalAuthoritySourceStore(pool)

  beforeAll(async () => {
    await store.upsertDocument(authority, provider)
  })

  afterAll(async () => {
    await pool.query(
      'delete from legal_source_withdrawal_audits where document_id = $1',
      [documentId],
    )
    await pool.query(
      'delete from legal_source_documents where document_id = $1',
      [documentId],
    )
    await pool.end()
  })

  it('serves the row in search and without a flag before withdrawal', async () => {
    const hits = await store.search('fiduciary appendix', {})
    expect(hits.map((hit) => hit.id)).toContain(documentId)

    const record = await store.get(documentId)
    expect(record?.withdrawn).toBeNull()
  })

  it('excludes the marked row from search but reports it on get', async () => {
    await pool.query(
      `update legal_source_documents
        set provider_json = legal_source_documents.provider_json || $2::jsonb,
          updated_at = now()
        where document_id = $1`,
      [documentId, JSON.stringify({ withdrawn })],
    )

    const hits = await store.search('fiduciary appendix', {})
    expect(hits.map((hit) => hit.id)).not.toContain(documentId)

    const record = await store.get(documentId)
    expect(record?.withdrawn).toEqual(withdrawn)
    expect(record?.document?.id).toBe(documentId)
  })
})
