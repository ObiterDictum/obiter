import { describe, expect, it } from 'vitest'
import {
  canonicalHydrationQueryKey,
  LegalSearchHydrationBudget,
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
})
