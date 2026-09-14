import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkQuoteFidelity } from './quote-fidelity'
import { acts, insertAct, request } from './quote-fidelity.test-support'

/**
 * Quote fidelity against the real Postgres public legal-source record for
 * legislation. A provision citation is compared only against its own provision,
 * and the single-schedule alias has one owner shared with the serving path.
 * Requires TEST_DATABASE_URL.
 */

const identity = 'ukpga/2077/1'

describe('quote fidelity legislation against the stored record', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for quote-fidelity-legislation.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })

  beforeAll(async () => {
    await pool.query(
      `delete from legislation_provisions where document_identity like 'ukpga/2077/%'`,
    )
    await pool.query(
      `delete from legislation_documents where identity like 'ukpga/2077/%'`,
    )
    for (const current of acts) {
      await insertAct(pool, current)
    }
  })

  afterAll(async () => {
    await pool.query(
      `delete from legislation_provisions where document_identity like 'ukpga/2077/%'`,
    )
    await pool.query(
      `delete from legislation_documents where identity like 'ukpga/2077/%'`,
    )
    await pool.end()
  })

  it('clears an exact quotation inside the cited provision', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'section/40',
      }),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: identity,
        labelPath: 'section/40',
      },
    ])
  })

  it('does not verify a provision citation with text from another provision', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'schedule/paragraph/4',
      }),
    )

    expect(finding.status).not.toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([])
  })

  it('flags a material legislation misquotation with the provision evidence', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('must act incompatibly', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'section/40',
      }),
    )

    expect(finding.status).toEqual({ state: 'flagged' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: identity,
        labelPath: 'section/40',
      },
    ])
  })

  it('reports a missing provision as evidence unavailable', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('any quotation', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'section/9999',
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('applies the single-schedule alias and evidences the stored path', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('The single schedule provision text.', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'schedule/1/paragraph/4',
      }),
    )

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: identity,
        labelPath: 'schedule/paragraph/4',
      },
    ])
  })

  it('does not compare against a provision whose text is not current', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('This provision has unapplied effects.', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: 'section/50',
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('reports a whole-Act citation as having no addressable provision', async () => {
    const finding = await checkQuoteFidelity(
      pool,
      request('must not act incompatibly', {
        kind: 'legislation',
        documentIdentity: identity,
        labelPath: null,
      }),
    )

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })
})
