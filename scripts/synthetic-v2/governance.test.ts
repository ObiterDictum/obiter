import { describe, expect, it } from 'vitest'
import {
  assertDisjointDatasetManifests,
  assertSelectionManifest,
  assertTournamentManifest,
  benchmarkAuditPlan,
  canonicalHash,
  requireSelection,
  selectionManifestVersion,
  tournamentManifestVersion,
  type TournamentManifest,
} from './governance'

const unsignedTournament: Omit<TournamentManifest, 'manifestHash'> = {
  version: tournamentManifestVersion,
  candidates: [
    {
      candidateId: 'deepseek-pro-haiku',
      specificationIds: [],
      seeds: [],
      canonicalArtifactHash: 'a'.repeat(64),
      blindReviewScorecardHash: 'b'.repeat(64),
      finalStatus: 'reviewed',
    },
  ],
}
const tournament = {
  ...unsignedTournament,
  manifestHash: canonicalHash(unsignedTournament),
}
const selection = {
  version: selectionManifestVersion,
  candidateId: 'deepseek-pro-haiku',
  writerId: 'deepseek-v4-pro',
  annotatorId: 'anthropic/claude-haiku-4.5',
  tournamentManifestHash: tournament.manifestHash,
  approvedAt: '2026-07-20T12:00:00.000Z',
  approvedBy: 'reviewer',
  termsReviewReference: 'terms-2026-07',
} as const

describe('synthetic-v2 governance', () => {
  it('requires a reviewed selection and its canonical tournament hash', () => {
    expect(() => requireSelection('training_seed', undefined)).toThrow(
      'selection manifest',
    )
    expect(() => requireSelection('tournament', undefined)).not.toThrow()
    expect(() =>
      requireSelection('benchmark', selection, tournament),
    ).not.toThrow()
    expect(() =>
      requireSelection(
        'benchmark',
        { ...selection, tournamentManifestHash: 'a'.repeat(64) },
        tournament,
      ),
    ).toThrow('does not match')
  })
  it('rejects tampered, unknown, and stale selection evidence', () => {
    expect(() =>
      assertSelectionManifest({ ...selection, candidateId: 'unknown' }),
    ).toThrow('unknown')
    expect(() =>
      assertSelectionManifest({ ...selection, writerId: 'different' }),
    ).toThrow('model IDs')
    expect(() =>
      assertTournamentManifest({ ...tournament, candidates: [{}] }),
    ).toThrow('stale')
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
