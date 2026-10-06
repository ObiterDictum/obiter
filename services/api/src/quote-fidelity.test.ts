import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

/**
 * The quote-fidelity store boundary for case law, against an injected pool. The
 * fake answers the real judgment query; the real SQL is exercised in
 * `quote-fidelity.db.test.ts`.
 */

/** Counts source preparations, to prove a batch prepares each authority once. */
const prepareCalls = vi.hoisted(() => ({ count: 0 }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const obiterVerificationCoreModule = {
  ...(await import('@obiter/verification-core')),
}
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterVerificationCoreModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/verification-core')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@obiter/verification-core', () =>
  Object.assign(
    { ...obiterVerificationCoreModuleKeys },
    (() => {
      const actual = obiterVerificationCoreModule
      return {
        ...actual,
        prepareQuoteSource: (texts: readonly string[]) => {
          prepareCalls.count += 1
          return actual.prepareQuoteSource(texts)
        },
      }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const {
  checkQuoteFidelity,
  checkQuoteFidelities,
  maxQuoteFidelityBatchSize,
  maxQuoteLength,
  maxSourceFragments,
  QuoteBatchTooLargeError,
  QuoteRequestTooLargeError,
} = await import('./quote-fidelity')
const {
  caseLaw,
  fakeQuotePool,
  judgmentAuthority,
  judgmentCitation,
  outcomes,
  rejections,
  request,
} = await import('./quote-fidelity.test-support')

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

    const results = await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('The court began here.', caseLaw),
      request('the court must consider the point', caseLaw),
    ])

    expect(outcomes(results)).toEqual(['clear', 'clear', 'clear'])
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

describe('quote fidelity candidate isolation', () => {
  it('keeps valid siblings when one candidate is blank', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    const results = await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('   ', caseLaw),
      request('the court must reject the point', caseLaw),
    ])

    expect(outcomes(results)).toEqual(['clear', 'quote_blank', 'flagged'])
    expect(rejections(results)).toEqual([null, 'quote_blank', null])
    // The rejected candidate is never read from the store.
    expect(fake.queryCount()).toBe(1)
  })

  it.each([
    ['spaces', '   '],
    ['tabs and newlines', '\t\r\n'],
    ['Unicode whitespace', '\u00a0\u2003'],
  ])(
    'rejects a quotation of %s without losing its siblings',
    async (_name, text) => {
      const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

      const results = await checkQuoteFidelities(fake.pool, [
        request(text, caseLaw),
        request('The court began here.', caseLaw),
      ])

      expect(outcomes(results)).toEqual(['quote_blank', 'clear'])
    },
  )

  it('keeps valid siblings when one candidate is not the slice its location names', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })
    const misSliced = {
      ...request('The court began here.', caseLaw),
      quote: {
        rawText: 'The court began here.',
        location: { paragraphId: 'p-1', start: 0, end: 5 },
      },
    }

    const results = await checkQuoteFidelities(fake.pool, [
      misSliced,
      request('The court began here.', caseLaw),
    ])

    expect(outcomes(results)).toEqual(['quote_span_mismatch', 'clear'])
  })

  it('keeps valid siblings when one candidate exceeds the quote bound', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    const results = await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('x'.repeat(maxQuoteLength + 1), caseLaw),
      request('The court began here.', caseLaw),
    ])

    expect(outcomes(results)).toEqual(['clear', 'quote_too_large', 'clear'])
  })
})

describe('quote fidelity batch bounds', () => {
  it('accepts a batch one below the limit and reads the source once', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })
    const requests = Array.from({ length: maxQuoteFidelityBatchSize - 1 }, () =>
      request('the court must consider the point', caseLaw),
    )

    const results = await checkQuoteFidelities(fake.pool, requests)

    expect(results).toHaveLength(maxQuoteFidelityBatchSize - 1)
    expect(outcomes(results).every((state) => state === 'clear')).toBe(true)
    expect(fake.queryCount()).toBe(1)
  })

  it('accepts a batch exactly at the limit', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })
    const requests = Array.from({ length: maxQuoteFidelityBatchSize }, () =>
      request('the court must consider the point', caseLaw),
    )

    const results = await checkQuoteFidelities(fake.pool, requests)

    expect(results).toHaveLength(maxQuoteFidelityBatchSize)
    expect(fake.queryCount()).toBe(1)
  })

  it('refuses a batch one over the limit before reading anything', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })
    const requests = Array.from({ length: maxQuoteFidelityBatchSize + 1 }, () =>
      request('the court must consider the point', caseLaw),
    )

    await expect(checkQuoteFidelities(fake.pool, requests)).rejects.toThrow(
      QuoteBatchTooLargeError,
    )
    expect(fake.queryCount()).toBe(0)
  })
})

describe('quote fidelity source preparation', () => {
  it('prepares one authority once for several quotations', async () => {
    prepareCalls.count = 0
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('The court began here.', caseLaw),
      request('the court must consider the point', caseLaw),
    ])

    expect(prepareCalls.count).toBe(1)
  })

  it('prepares each distinct authority identity separately', async () => {
    prepareCalls.count = 0
    const second = {
      id: 'db-test-v4-second',
      paragraphs: [{ paragraphNumber: 1, text: 'A second judgment text.' }],
    }
    const fake = fakeQuotePool({
      authorities: [judgmentAuthority, second],
    })

    await checkQuoteFidelities(fake.pool, [
      request('the court must consider the point', caseLaw),
      request('A second judgment text.', judgmentCitation('db-test-v4-second')),
      request('The court began here.', caseLaw),
    ])

    expect(prepareCalls.count).toBe(2)
  })

  it('prepares nothing for an empty batch', async () => {
    prepareCalls.count = 0
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })

    await checkQuoteFidelities(fake.pool, [])

    expect(prepareCalls.count).toBe(0)
  })
})

describe('quote fidelity determinism', () => {
  it('returns the same batch in the same order for the same input', async () => {
    const fake = fakeQuotePool({ authorities: [judgmentAuthority] })
    const requests = [
      request('the court must consider the point', caseLaw),
      request('   ', caseLaw),
      request('the points', caseLaw),
      request('The court began here.', caseLaw),
    ]

    const first = await checkQuoteFidelities(fake.pool, requests)
    const second = await checkQuoteFidelities(fake.pool, requests)

    expect(outcomes(first)).toEqual([
      'clear',
      'quote_blank',
      'review_required',
      'clear',
    ])
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first))
  })
})
