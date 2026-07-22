import { afterEach, describe, expect, it } from 'vitest'
import type { PricingTable } from './budget'
import type { RequestTelemetry } from './types'
import { corpusStageSpecs } from './program'
import {
  assertSmokeBudget,
  assertSmokeOptIn,
  firstAttemptContractValid,
  parseSmokeProfile,
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
  'anthropic/claude-sonnet-4.6': {
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
  it('does not qualify structurally repaired provider output', () => {
    const state = {
      generationAttempts: 1,
      annotationAttempts: 1,
      repairAttempts: 0,
      regenerationAttempts: 0,
    }
    const successfulTelemetry: RequestTelemetry[] = [
      'writer',
      'annotator',
      'primary_judge',
      'dispute_judge',
    ].map((role, index) => ({
      requestId: `success-${index}`,
      specId: 'tournament-00001',
      role: role as RequestTelemetry['role'],
      requestedModel: 'model',
      latencyMs: 1,
      status: 'success',
      attempt: 1,
    }))
    expect(firstAttemptContractValid(successfulTelemetry, [state])).toBe(true)
    expect(
      firstAttemptContractValid(
        [
          ...successfulTelemetry,
          {
            requestId: 'request-1',
            specId: 'tournament-00001',
            role: 'annotator',
            requestedModel: 'model',
            latencyMs: 1,
            status: 'error',
            errorCode: 'annotation_span_overlap',
            attempt: 1,
          },
        ],
        [state],
      ),
    ).toBe(false)
    expect(
      firstAttemptContractValid(successfulTelemetry, [
        { ...state, annotationAttempts: 2 },
      ]),
    ).toBe(false)
  })

  it('uses one bounded standard specification outside corpus IDs', () => {
    const spec = smokeSpecification()
    expect(spec.id).toBe('smoke-00001')
    expect(spec.seed).toMatch(/^smoke:/)
    expect(spec.difficulty).toBe('standard')
    expect(spec.lengthWords).toBe(300)
    expect(spec.requiredCategories).not.toContain('person_protected')
    expect(spec.hardNegatives).toEqual([])
  })

  it('uses an unabridged tournament specification for canary qualification', () => {
    const spec = smokeSpecification('tournament-canary')
    expect(spec).toEqual(corpusStageSpecs('tournament')[0])
    expect(spec.lengthWords).toBeGreaterThan(300)
    expect(spec.requiredCategories).toContain('person_protected')
  })

  it('rejects unknown smoke profiles instead of silently simplifying them', () => {
    expect(parseSmokeProfile(undefined)).toBe('connectivity')
    expect(parseSmokeProfile('tournament-canary')).toBe('tournament-canary')
    expect(() => parseSmokeProfile('tournament')).toThrow('Unsupported')
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
    expect(estimate).toBe(0.7344)
    const selectedEstimate = smokeWorstCaseGbp(
      pricing,
      'judge-primary',
      'judge-dispute',
      1,
      'zai',
      'opencode-go',
      [
        {
          id: 'deepseek-pro-sonnet',
          writer: 'deepseek-v4-pro',
          annotator: 'anthropic/claude-sonnet-4.6',
          reviewed: true,
        },
      ],
    )
    expect(selectedEstimate).toBe(0.2592)
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
