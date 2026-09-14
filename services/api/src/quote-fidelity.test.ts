import { describe, expect, it, vi } from 'vitest'
import {
  checkQuoteFidelity,
  checkQuoteFidelities,
  maxQuoteLength,
  maxSourceFragments,
  QuoteRequestTooLargeError,
} from './quote-fidelity'
import {
  caseLaw,
  fakeQuotePool,
  judgmentAuthority,
  request,
} from './quote-fidelity.test-support'

/**
 * The quote-fidelity store boundary for case law, against an injected pool. The
 * fake answers the real judgment query; the real SQL is exercised in
 * `quote-fidelity.db.test.ts`.
 */

describe('quote fidelity judgment retrieval', () => {
  it('clears an exact judgment quotation with its paragraph evidence', async () => {
    const { pool } = fakeQuotePool({ authorities: [judgmentAuthority] })

    const finding = await checkQuoteFidelity(
      pool,
      request('the court must consider the point', caseLaw),
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

  it('flags a proven mismatch from the stored record', async () => {
    const { pool } = fakeQuotePool({ authorities: [judgmentAuthority] })

    const finding = await checkQuoteFidelity(
      pool,
      request('the court must reject the point', caseLaw),
    )

    expect(finding.status).toEqual({ state: 'flagged' })
    expect(finding.evidence).toHaveLength(1)
  })

  it('reads one judgment once for every quotation that cites it', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    const findings = await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('The court began here.', caseLaw),
      request('the court must consider the point', caseLaw),
    ])

    expect(findings.map((finding) => finding.status.state)).toEqual([
      'clear',
      'clear',
      'clear',
    ])
    expect(fake.queryCount()).toBe(1)
  })

  it('issues no query for an empty batch', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    expect(await checkQuoteFidelities(fake.pool, [])).toEqual([])
    expect(fake.queryCount()).toBe(0)
  })

  it('does not compare against a withdrawn source', async () => {
    const { pool } = fakeQuotePool({
      authorities: [{ ...judgmentAuthority, withdrawn: true }],
    })

    const finding = await checkQuoteFidelity(
      pool,
      request('the court must consider the point', caseLaw),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
    expect(finding.evidence).toEqual([])
  })

  it('reports a malformed stored record as inconclusive, not a mismatch', async () => {
    const { pool } = fakeQuotePool({
      authorities: [{ id: 'db-test-v4-uksc', malformed: true }],
    })

    const finding = await checkQuoteFidelity(
      pool,
      request('the court must consider the point', caseLaw),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('reports a store failure as inconclusive and never logs the quote', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pool } = fakeQuotePool({
      authorities: [judgmentAuthority],
      fail: 'authorities',
    })

    const finding = await checkQuoteFidelity(
      pool,
      request('a private matter quotation', caseLaw),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private matter')
    warn.mockRestore()
  })

  it('refuses a quote longer than the boundary accepts', async () => {
    const { pool } = fakeQuotePool({ authorities: [judgmentAuthority] })

    await expect(
      checkQuoteFidelity(
        pool,
        request('x'.repeat(maxQuoteLength + 1), caseLaw),
      ),
    ).rejects.toThrow(QuoteRequestTooLargeError)
  })

  it('refuses a source larger than the comparison bounds', async () => {
    const paragraphs = Array.from(
      { length: maxSourceFragments + 1 },
      (_, index) => ({
        paragraphNumber: index + 1,
        text: 'x',
      }),
    )
    const { pool } = fakeQuotePool({
      authorities: [{ id: 'db-test-v4-uksc', paragraphs }],
    })

    const finding = await checkQuoteFidelity(pool, request('x', caseLaw))

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('refuses a stored identity that disagrees with the citation', async () => {
    const { pool } = fakeQuotePool({
      authorities: [{ ...judgmentAuthority, documentId: 'db-test-v4-other' }],
    })

    const finding = await checkQuoteFidelity(
      pool,
      request('the court must consider the point', caseLaw),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('scopes the judgment read to the resolved source id and never sends quote text', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    await checkQuoteFidelity(
      fake.pool,
      request('the court must consider the point', caseLaw),
    )

    const read = fake.calls[0]
    expect(read?.values).toEqual(['db-test-v4-uksc'])
    expect(JSON.stringify(fake.calls)).not.toContain('must consider')
  })
})
