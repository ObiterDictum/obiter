import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  ANONYMOUS_HYDRATION_SUBJECT,
  canonicalHydrationQueryKey,
  documentHydrationKey,
  LegalSearchHydrationBudget,
  LegalSourceHydrationGate,
} from './legal-search-hydration-budget'

describe('LegalSearchHydrationBudget', () => {
  it('deduplicates in-flight misses by canonical query key', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 24,
      perClientMax: 12,
      windowMs: 600_000,
    })
    const key = canonicalHydrationQueryKey({ query: 'Potanina', court: 'uksc' })

    expect(budget.tryBeginHydration('usr_1', key)).toEqual({ status: 'queued' })
    expect(budget.tryBeginHydration('usr_2', key)).toEqual({
      status: 'deduped',
    })
  })

  it('returns budget_exceeded when the queue is full', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 2,
      perClientMax: 12,
      windowMs: 600_000,
    })

    expect(
      budget.tryBeginHydration('usr_1', '{"query":"one","court":null}'),
    ).toEqual({ status: 'queued' })
    expect(
      budget.tryBeginHydration('usr_1', '{"query":"two","court":null}'),
    ).toEqual({ status: 'queued' })
    expect(
      budget.tryBeginHydration('usr_1', '{"query":"three","court":null}'),
    ).toEqual({ status: 'budget_exceeded' })
  })

  it('returns budget_exceeded on the 13th distinct miss for one user in the window', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 24,
      perClientMax: 12,
      windowMs: 600_000,
    })

    for (let index = 0; index < 12; index += 1) {
      const key = canonicalHydrationQueryKey({ query: `query-${index}` })
      expect(budget.tryBeginHydration('usr_1', key).status).toBe('queued')
      budget.completeHydration(key)
    }

    expect(
      budget.tryBeginHydration(
        'usr_1',
        canonicalHydrationQueryKey({ query: 'query-12' }),
      ).status,
    ).toBe('budget_exceeded')
  })

  it('bounds the number of retained per-user windows with LRU eviction', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 100,
      perClientMax: 5,
      windowMs: 600_000,
      retainedUserWindowMax: 10,
    })

    for (let index = 0; index < 50; index += 1) {
      const key = canonicalHydrationQueryKey({ query: `query-${index}` })
      budget.tryBeginHydration(`usr_${index}`, key)
      budget.completeHydration(key)
    }

    expect(budget.retainedUserMissWindows()).toBeLessThanOrEqual(10)
  })

  it('bounds the number of retained per-user windows when the window has not expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'))
    const budget = new LegalSearchHydrationBudget({
      queueMax: 100,
      perClientMax: 5,
      windowMs: 600_000,
      retainedUserWindowMax: 3,
    })

    for (let index = 0; index < 20; index += 1) {
      const key = canonicalHydrationQueryKey({ query: `query-${index}` })
      budget.tryBeginHydration(`usr_${index}`, key)
      budget.completeHydration(key)
    }

    expect(budget.retainedUserMissWindows()).toBeLessThanOrEqual(3)
  })

  it('resets a spent window when the retention cap evicts it', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 100,
      perClientMax: 1,
      windowMs: 600_000,
      retainedUserWindowMax: 2,
    })
    const victimKey = canonicalHydrationQueryKey({ query: 'victim' })
    expect(budget.tryBeginHydration('usr_victim', victimKey)).toEqual({
      status: 'queued',
    })
    budget.completeHydration(victimKey)
    expect(
      budget.tryBeginHydration(
        'usr_victim',
        canonicalHydrationQueryKey({ query: 'again' }),
      ),
    ).toEqual({ status: 'budget_exceeded' })

    // Two more users plus a third push the victim's window off the LRU cap.
    for (const name of ['a', 'b', 'c']) {
      const key = canonicalHydrationQueryKey({ query: name })
      budget.tryBeginHydration(`usr_${name}`, key)
      budget.completeHydration(key)
    }

    // Pinned contract: eviction resets the count, so the per-user window is a
    // fairness bound, not a hard identity bound.
    expect(
      budget.tryBeginHydration(
        'usr_victim',
        canonicalHydrationQueryKey({ query: 'fresh' }),
      ),
    ).toEqual({ status: 'queued' })
  })

  it('drops expired per-user miss windows instead of retaining empty keys', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'))
    const budget = new LegalSearchHydrationBudget({
      queueMax: 24,
      perClientMax: 12,
      windowMs: 60_000,
    })
    const goneKey = canonicalHydrationQueryKey({ query: 'gone' })
    expect(budget.tryBeginHydration('usr_gone', goneKey)).toEqual({
      status: 'queued',
    })
    budget.completeHydration(goneKey)
    expect(budget.retainedUserMissWindows()).toBe(1)

    vi.setSystemTime(new Date('2026-08-30T12:02:00Z'))
    const otherKey = canonicalHydrationQueryKey({ query: 'other' })
    expect(budget.tryBeginHydration('usr_other', otherKey)).toEqual({
      status: 'queued',
    })
    expect(budget.retainedUserMissWindows()).toBe(1)
  })

  it('keeps the anonymous subject isolated from real user windows', () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 100,
      perClientMax: 1,
      windowMs: 600_000,
    })
    const anonymousKey = documentHydrationKey('doc-a')
    expect(
      budget.tryBeginHydration(ANONYMOUS_HYDRATION_SUBJECT, anonymousKey),
    ).toEqual({ status: 'queued' })
    budget.completeHydration(anonymousKey)

    // A synthetic session id must get its own window, not share the anonymous
    // bucket. The colon in the sentinel is outside the id alphabet.
    const userKey = documentHydrationKey('doc-b')
    expect(budget.tryBeginHydration('usr_real', userKey)).toEqual({
      status: 'queued',
    })
    budget.completeHydration(userKey)
    expect(
      budget.tryBeginHydration(
        ANONYMOUS_HYDRATION_SUBJECT,
        documentHydrationKey('doc-c'),
      ),
    ).toEqual({ status: 'budget_exceeded' })
  })

  it('releases the reservation when the operation throws synchronously', async () => {
    const budget = new LegalSearchHydrationBudget({
      queueMax: 1,
      perClientMax: 2,
      windowMs: 600_000,
    })
    const gate = new LegalSourceHydrationGate(budget)

    const thrown = await gate.run('usr_a', 'query-a', () => {
      throw new Error('synchronous provider failure')
    })
    expect(thrown).toEqual({ status: 'failed' })

    // The queue slot was released, so the next operation still reserves.
    const next = await gate.run('usr_a', 'query-b', async () => 'ok')
    expect(next).toEqual({ status: 'ok', value: 'ok' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
