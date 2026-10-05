import { createTestPool } from '../../../test-database.test-support'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createPostgresLegalAuthoritySourceStore } from '../source-store'

/**
 * The withdrawal/indexing race, against the real Postgres store.
 *
 * Hydration used to read the row, decide it was live, write, and index. A
 * withdrawal that committed between the read and the write therefore lost: the
 * merge preserved the flag, but the document had already been queued for the
 * index, and `excludeWithdrawnIndexHits` only hides that at read time. On a
 * shared index one lane's race is every lane's drift until the next rebuild.
 *
 * The write now reports the merged row's withdrawal state, so these tests hold
 * that decision to a real serialised withdrawal rather than to a mocked one.
 * Without the `returning` clause the write has no post-merge state to report
 * and the caller indexes unconditionally, which is the failure these assertions
 * exist to catch. Requires TEST_DATABASE_URL.
 */

const documentId = 'db-test-indexability-2026-1'

const authority = {
  id: documentId,
  title: 'Indexability Test Judgment Concerning Withdrawal Ordering',
  neutralCitation: null,
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2026-02-10',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2026/9',
  paragraphs: [
    {
      id: `${documentId}-p1`,
      documentId,
      paragraphNumber: 1,
      text: 'The ordering of a withdrawal against a hydration write decides whether this judgment may be indexed.',
    },
  ],
}

const provider = {
  documentUri: '/uksc/2026/9',
  sourceUri: '/uksc/2026/9',
  xmlUri: '/uksc/2026/9/data.xml',
  pdfUri: null,
  contentHash: 'dbtest-indexability',
  rawAtomEntry: '<entry />',
}

const withdrawn = {
  at: '2026-09-02T00:00:00.000Z',
  checkedUris: ['/uksc/2026/9'],
  runIds: ['run-indexability'],
}

describe('corpus write indexability against the stored record', () => {
  const pool = createTestPool()
  const store = createPostgresLegalAuthoritySourceStore(pool)

  beforeAll(async () => {
    await pool.query(
      'delete from legal_source_documents where document_id = $1',
      [documentId],
    )
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

  it('reports a fresh write as indexable', async () => {
    const result = await store.upsertDocument(authority, provider)

    expect(result.indexable).toBe(true)
  })

  it('refuses to index a write that serialised behind a withdrawal', async () => {
    // The withdrawal takes the row lock first and holds it, exactly as the
    // checker's own statement does. The hydration write then waits for that
    // lock, so the order is forced rather than hoped for.
    const blocker = await pool.connect()
    await blocker.query('begin')
    await blocker.query(
      `update legal_source_documents
        set provider_json = legal_source_documents.provider_json || $2::jsonb,
          updated_at = now()
        where document_id = $1`,
      [documentId, JSON.stringify({ withdrawn })],
    )

    let settled = false
    const write = store.upsertDocument(authority, provider).then((value) => {
      settled = true
      return value
    })

    // The write cannot settle while the blocker holds the row lock, so this is
    // an ordering assertion, not a timing one.
    expect(settled).toBe(false)

    await blocker.query('commit')
    blocker.release()

    const result = await write
    expect(result.indexable).toBe(false)

    // The flag survived the merge: a "fresh" provider payload never carries it,
    // so a replace-shaped upsert would clear it here.
    const record = await store.get(documentId)
    expect(record?.withdrawn).toEqual(withdrawn)
  })

  it('reports a re-write over a withdrawn row as not indexable', async () => {
    const result = await store.upsertDocument(authority, provider)

    expect(result.indexable).toBe(false)

    const record = await store.get(documentId)
    expect(record?.withdrawn).toEqual(withdrawn)
  })

  it('reports a summary write over a withdrawn row as not indexable', async () => {
    const result = await store.upsertSummary(authority, provider)

    expect(result.indexable).toBe(false)
  })

  it('reports a write as indexable again once the withdrawal is cleared', async () => {
    // The manual runbook is the only thing that clears the flag; this proves
    // the guard follows the stored state rather than latching.
    await pool.query(
      `update legal_source_documents
        set provider_json = legal_source_documents.provider_json - 'withdrawn',
          updated_at = now()
        where document_id = $1`,
      [documentId],
    )

    const result = await store.upsertDocument(authority, provider)

    expect(result.indexable).toBe(true)
  })
})
