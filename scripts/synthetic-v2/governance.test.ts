import { describe, expect, it } from 'vitest'
import {
  assertDisjointDatasetManifests,
  benchmarkAuditPlan,
  requireSelection,
} from './governance'

describe('synthetic-v2 governance', () => {
  it('requires a reviewed selection for corpus stages', () => {
    expect(() => requireSelection('training_seed', undefined)).toThrow(
      'selection manifest',
    )
    expect(() => requireSelection('tournament', undefined)).not.toThrow()
    expect(() =>
      requireSelection('benchmark', {
        candidateId: 'deepseek-pro-haiku',
        tournamentManifestHash: 'x',
        approvedAt: 'now',
        approvedBy: 'reviewer',
      }),
    ).not.toThrow()
  })
  it('rejects cross-partition document reuse and defines benchmark audit strata', () => {
    expect(() =>
      assertDisjointDatasetManifests([
        { stage: 'train', documentHashes: ['a'] },
        { stage: 'bench', documentHashes: ['a'] },
      ]),
    ).toThrow('overlap')
    expect(benchmarkAuditPlan.minimumHumanAuditFraction).toBe(0.15)
  })
})
