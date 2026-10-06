import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

/**
 * The quote-fidelity store boundary for legislation, against an injected pool.
 * The point is the scoping: a provision citation is compared against its own
 * provision, the single-schedule alias has one owner, provision text that is
 * not a verified current version is never compared against, and a store that
 * contradicts the citation it resolved fails closed.
 */

/**
 * A source-integrity conflict is a typed error raised by the comparison when
 * the boundary's fragments contradict the citation it resolved. A correct
 * boundary cannot produce one, so the branch is exercised here by making the
 * comparison raise it for one sentinel quotation.
 */
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
        decideQuoteFidelity: (
          input: Parameters<typeof actual.decideQuoteFidelity>[0],
        ) => {
          if (input.quote.rawText.includes('integrity sentinel')) {
            throw new actual.QuoteSourceMismatchError(
              'The fragment is not the provision the citation resolved to.',
            )
          }
          return actual.decideQuoteFidelity(input)
        },
      }
    })(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { checkQuoteFidelity, checkQuoteFidelities } =
  await import('./quote-fidelity')
import type { ActFixture } from './quote-fidelity.test-support'
const {
  act,
  caseLaw,
  fakeQuotePool,
  findings,
  judgmentAuthority,
  legislation,
  outcomes,
  rejections,
  request,
} = await import('./quote-fidelity.test-support')

describe('quote fidelity legislation retrieval', () => {
  it('clears a provision quotation on the cited provision', async () => {
    const { pool } = fakeQuotePool({ acts: [act] })

    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', legislation),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2066/1',
        labelPath: 'section/40',
      },
    ])
  })

  it('evidences the resolved canonical path for every quotation against it', async () => {
    const scheduleAct: ActFixture = {
      ...act,
      provisions: [
        {
          labelPath: 'schedule/paragraph/4',
          text: 'The schedule provision text.',
        },
      ],
    }
    const fake = fakeQuotePool({ acts: [scheduleAct] })
    const citation = {
      kind: 'legislation',
      documentIdentity: 'ukpga/2066/1',
      labelPath: 'schedule/1/paragraph/4',
    } as const

    const results = await checkQuoteFidelities(fake.pool, [
      request('The schedule provision text.', citation),
      request('schedule provision', citation),
    ])

    const [first, second] = findings(results)
    expect(first?.evidence).toEqual(second?.evidence)
    expect(first?.evidence[0]).toMatchObject({
      labelPath: 'schedule/paragraph/4',
    })
  })

  it('reports a missing provision as evidence unavailable, not a mismatch', async () => {
    const { pool } = fakeQuotePool({ acts: [act] })

    const finding = await checkQuoteFidelity(
      pool,
      request('any words', {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: 'section/12345',
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('reports a whole-Act citation as having no addressable provision', async () => {
    const { pool } = fakeQuotePool({ acts: [act] })

    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: null,
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('applies the single-schedule alias and evidences the stored path', async () => {
    const scheduleAct: ActFixture = {
      ...act,
      provisions: [
        {
          labelPath: 'schedule/paragraph/4',
          text: 'The schedule provision text.',
        },
      ],
    }
    const { pool } = fakeQuotePool({ acts: [scheduleAct] })

    const finding = await checkQuoteFidelity(
      pool,
      request('The schedule provision text.', {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: 'schedule/1/paragraph/4',
      }),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2066/1',
        labelPath: 'schedule/paragraph/4',
      },
    ])
  })

  it('reports a citation for another schedule as unavailable, never a clear', async () => {
    const scheduleAct: ActFixture = {
      ...act,
      provisions: [
        {
          labelPath: 'schedule/paragraph/4',
          text: 'The schedule provision text.',
        },
      ],
    }
    const { pool } = fakeQuotePool({ acts: [scheduleAct] })

    const finding = await checkQuoteFidelity(
      pool,
      request('The schedule provision text.', {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: 'schedule/2/paragraph/4',
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
    expect(finding.evidence).toEqual([])
  })

  it('does not compare against provision text that is not a verified current version', async () => {
    const staleAct: ActFixture = {
      ...act,
      provisions: [
        {
          labelPath: 'section/40',
          text: 'A public authority must not act incompatibly with the Convention.',
          hasUnappliedEffects: true,
        },
      ],
    }
    const { pool } = fakeQuotePool({ acts: [staleAct] })

    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', legislation),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('reads one provision once for every quotation that cites it', async () => {
    const fake = fakeQuotePool({ acts: [act] })

    const results = await checkQuoteFidelities(fake.pool, [
      request('must not act incompatibly', legislation),
      request('with the Convention', legislation),
    ])

    expect(outcomes(results)).toEqual(['clear', 'clear'])
    expect(
      fake.calls.filter((call) =>
        call.text.includes('from legislation_documents where identity'),
      ).length,
    ).toBe(1)
  })

  it('reports a legislation store failure as inconclusive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pool } = fakeQuotePool({ acts: [act], fail: 'legislation' })

    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', legislation),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    warn.mockRestore()
  })
})

describe('quote fidelity legislation source integrity', () => {
  const defectiveAct: ActFixture = {
    identity: 'ukpga/2066/1',
    year: 2066,
    number: 1,
    title: 'Test Authority Act 2066',
    provisions: [
      {
        labelPath: 'section/40',
        text: 'A public authority must not act incompatibly with the Convention.',
      },
      { labelPath: 'section/41', text: 'A different provision entirely.' },
    ],
    mislabelledProvision: { asked: 'section/40', returned: 'section/41' },
  }

  it('fails closed when the store returns another provision for the citation', async () => {
    const { pool } = fakeQuotePool({ acts: [defectiveAct] })

    const finding = await checkQuoteFidelity(
      pool,
      request('A different provision entirely.', legislation),
    )

    expect(finding.status.state).not.toBe('clear')
    expect(finding.status.state).not.toBe('flagged')
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.evidence).toEqual([])
  })

  it('fails closed when the store returns another Act for the citation', async () => {
    const { pool } = fakeQuotePool({
      acts: [
        {
          ...defectiveAct,
          mislabelledProvision: {
            asked: 'section/40',
            returned: 'section/41',
            documentIdentity: 'ukpga/2066/9',
          },
        },
      ],
    })

    const finding = await checkQuoteFidelity(
      pool,
      request('A different provision entirely.', legislation),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('confines a source-integrity conflict to its own candidate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakeQuotePool({ acts: [act] })

    const results = await checkQuoteFidelities(fake.pool, [
      request('integrity sentinel quotation', legislation),
      request('must not act incompatibly', legislation),
    ])

    expect(rejections(results)).toEqual(['source_identity_conflict', null])
    expect(outcomes(results)).toEqual(['source_identity_conflict', 'clear'])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('integrity sentinel')
    warn.mockRestore()
  })

  it('does not let a legislation failure affect a case-law sibling', async () => {
    const fake = fakeQuotePool({
      acts: [defectiveAct],
      authorities: [judgmentAuthority],
    })

    const results = await checkQuoteFidelities(fake.pool, [
      request('A different provision entirely.', legislation),
      request('the court must consider the point', caseLaw),
    ])

    expect(outcomes(results)).toEqual(['review_required', 'clear'])
  })
})
