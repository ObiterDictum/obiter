import { afterEach, describe, expect, it } from 'vitest'
import type { PricingTable } from './budget'
import {
  assertSmokeBudget,
  assertSmokeOptIn,
  smokeSpecification,
  smokeWorstCaseGbp,
} from './smoke'

const originalRunOptIn = process.env.OBITER_RUN_SYNTHETIC_V2
const originalTerms = process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED

afterEach(() => {
  if (originalRunOptIn === undefined) delete process.env.OBITER_RUN_SYNTHETIC_V2
  else process.env.OBITER_RUN_SYNTHETIC_V2 = originalRunOptIn
  if (originalTerms === undefined)
    delete process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED
  else process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED = originalTerms
})

const pricing: PricingTable = {
  'deepseek-v4-pro': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
  'deepseek-v4-flash': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
  'anthropic/claude-opus-4.8': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
  'google/gemini-3.6-flash': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
  'zai:judge-primary': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
  'opencode-go:judge-dispute': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
  },
}

describe('synthetic v2 provider smoke preflight', () => {
  it('uses one bounded standard specification outside corpus IDs', () => {
    const spec = smokeSpecification()
    expect(spec.id).toBe('smoke-00001')
    expect(spec.seed).toMatch(/^smoke:/)
    expect(spec.difficulty).toBe('standard')
    expect(spec.lengthWords).toBe(300)
    expect(spec.requiredCategories).not.toContain('person_protected')
    expect(spec.hardNegatives).toEqual([])
  })

  it('calculates a bounded worst-case reservation and rejects a lower cap', () => {
    const estimate = smokeWorstCaseGbp(
      pricing,
      'judge-primary',
      'judge-dispute',
      1,
      'zai',
      'opencode-go',
    )
    expect(estimate).toBe(0.1989)
    const selectedEstimate = smokeWorstCaseGbp(
      pricing,
      'judge-primary',
      'judge-dispute',
      1,
      'zai',
      'opencode-go',
      [
        {
          id: 'deepseek-pro-gemini-flash',
          writer: 'deepseek-v4-pro',
          annotator: 'google/gemini-3.6-flash',
          reviewed: true,
        },
      ],
    )
    expect(selectedEstimate).toBe(0.0702)
    expect(() => assertSmokeBudget(estimate, estimate)).not.toThrow()
    expect(() => assertSmokeBudget(estimate, estimate - 0.000001)).toThrow(
      'exceeds cap',
    )
  })

  it('requires both explicit network and terms opt-ins', () => {
    delete process.env.OBITER_RUN_SYNTHETIC_V2
    delete process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED
    expect(() => assertSmokeOptIn()).toThrow('Refusing smoke provider calls')
    process.env.OBITER_RUN_SYNTHETIC_V2 = '1'
    expect(() => assertSmokeOptIn()).toThrow('terms gate')
    process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED = '1'
    expect(() => assertSmokeOptIn()).not.toThrow()
  })
})
