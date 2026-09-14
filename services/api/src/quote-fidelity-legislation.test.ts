import { describe, expect, it, vi } from 'vitest'
import { checkQuoteFidelity, checkQuoteFidelities } from './quote-fidelity'
import {
  act,
  fakeQuotePool,
  legislation,
  request,
  type ActFixture,
} from './quote-fidelity.test-support'

/**
 * The quote-fidelity store boundary for legislation, against an injected pool.
 * The point is the scoping: a provision citation is compared against its own
 * provision, the single-schedule alias has one owner, and provision text that
 * is not a verified current version is never compared against.
 */

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

    const findings = await checkQuoteFidelities(fake.pool, [
      request('must not act incompatibly', legislation),
      request('with the Convention', legislation),
    ])

    expect(findings.map((finding) => finding.status.state)).toEqual([
      'clear',
      'clear',
    ])
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
