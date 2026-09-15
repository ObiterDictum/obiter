import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkQuoteFidelity, checkQuoteFidelities } from './quote-fidelity'
import {
  insertJudgment,
  judgmentCitation,
  judgments,
  outcomes,
  request,
} from './quote-fidelity.test-support'

/**
 * Quote fidelity against the real Postgres public legal-source record for case
 * law. The comparison matrix is exercised in the pure suite; these are the
 * end-to-end retrievals that prove the store scoping. Requires
 * TEST_DATABASE_URL.
 */

describe('quote fidelity judgments against the stored record', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for quote-fidelity.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })

  beforeAll(async () => {
    await pool.query(
      `delete from legal_source_documents where document_id like 'db-test-v4-%'`,
    )
    for (const fixture of judgments) {
      await insertJudgment(pool, fixture)
    }
  })

  afterAll(async () => {
    await pool.query(
      `delete from legal_source_documents where document_id like 'db-test-v4-%'`,
    )
    await pool.end()
  })

  it('clears an exact quotation inside a numbered paragraph', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'The court must consider the point carefully.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'db-test-v4-uksc',
        ordinal: 2,
        paragraphNumber: 2,
      },
    ])
  })

  it('flags a materially bad quotation from the stored record', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('The defendant was liable.', judgmentCitation('db-test-v4-uksc')),
    )

    expect(finding.status).toEqual({ state: 'flagged' })
    expect(finding.evidence).toHaveLength(1)
  })

  it('matches a quotation spanning two adjacent paragraphs and names both', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'A quotation spanning two paragraphs begins and continues into the next one.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'db-test-v4-uksc',
        ordinal: 4,
        paragraphNumber: 4,
      },
      {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: 'db-test-v4-uksc',
        ordinal: 5,
        paragraphNumber: 5,
      },
    ])
  })

  it('matches across the soft hyphen and curly quote folds', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'A hyphen and a "curly" view.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status).toEqual({ state: 'clear' })
  })

  it('does not clear a punctuation difference', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'The court must consider the point.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status.state).not.toBe('clear')
  })

  it('reports a quotation it cannot locate as review required, never a mismatch', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'A sentence that appears nowhere in the stored judgment at all.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('reports an empty paragraph collection as evidence unavailable', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('any quotation', judgmentCitation('db-test-v4-summary-only')),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('does not compare against a withdrawn judgment', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'Withdrawn source text.',
        judgmentCitation('db-test-v4-withdrawn'),
      ),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('reports a schema-invalid stored judgment as inconclusive', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('any quotation', judgmentCitation('db-test-v4-malformed')),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('reports a store failure as inconclusive and never logs the quote', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      query: async () => {
        throw new Error('connection terminated unexpectedly')
      },
    } as unknown as Pick<Pool, 'query'>

    const finding = await checkQuoteFidelity(
      broken,
      request('any quotation', judgmentCitation('db-test-v4-uksc')),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('any quotation')
    warn.mockRestore()
  })

  it('does not clear a quotation clipped inside a stored word', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request(
        'he court must consider the point',
        judgmentCitation('db-test-v4-uksc'),
      ),
    )

    expect(finding.status.state).not.toBe('clear')
    expect(finding.status.state).not.toBe('flagged')
    expect(finding.evidence).toEqual([])
  })

  it('keeps valid siblings when one candidate is blank, against the stored record', async () => {
    const results = await checkQuoteFidelities(pool, [
      request(
        'The court must consider the point carefully.',
        judgmentCitation('db-test-v4-uksc'),
      ),
      request('\u00a0   ', judgmentCitation('db-test-v4-uksc')),
    ])

    expect(outcomes(results)).toEqual(['clear', 'quote_blank'])
  })

  it('reads one judgment once for a batch of quotations', async () => {
    let reads = 0
    const counting = {
      query: (text: string, values?: unknown[]) => {
        if (text.includes('from legal_source_documents')) reads += 1
        return pool.query(text, values as never)
      },
    } as unknown as Pick<Pool, 'query'>

    const results = await checkQuoteFidelities(counting, [
      request(
        'The court must consider the point carefully.',
        judgmentCitation('db-test-v4-uksc'),
      ),
      request(
        'The defendant was not liable.',
        judgmentCitation('db-test-v4-uksc'),
      ),
      request(
        'The court must consider the point carefully.',
        judgmentCitation('db-test-v4-uksc'),
      ),
    ])

    expect(outcomes(results)).toEqual(['clear', 'clear', 'clear'])
    expect(reads).toBe(1)
  })
})
