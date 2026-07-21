import { describe, expect, it } from 'vitest'
import { corpusStageSpecs } from './program'
import {
  assertDisjointDatasetManifests,
  assertExternalPartitionRegistry,
  assertSelectionManifest,
  assertTournamentManifest,
  benchmarkAuditPlan,
  blindReviewPackage,
  canonicalHash,
  finalizeTournament,
  partitionManifest,
  partitionRegistry,
  requireSelection,
  reviewedCandidates,
  selectionManifestVersion,
  tournamentManifestVersion,
  type TournamentManifest,
} from './governance'

const blindPackages = reviewedCandidates.map((_, index) =>
  blindReviewPackage(`review-${index + 1}`, [
    {
      id: `document-${index + 1}`,
      text: 'Fictional tournament document.',
      spans: [],
      generator: 'fixture',
      specCell: 'fixture',
      matrixCells: [],
      contentHash: 'a'.repeat(64),
    },
  ]),
)
const scorecard = {
  annotation_accuracy: 5,
  hard_negative_handling: 5,
  realism: 5,
}
const unsignedTournament: Omit<TournamentManifest, 'manifestHash'> = {
  version: tournamentManifestVersion,
  candidates: reviewedCandidates.map((candidate, index) => ({
    candidateId: candidate.id,
    blindId: `review-${index + 1}`,
    specificationIds: [`tournament-${index}`],
    seeds: [`seed-${index}`],
    canonicalArtifactHash: String(index).repeat(64),
    blindReviewPackageHash: canonicalHash(blindPackages[index]),
    blindReviewScorecardHash: canonicalHash(scorecard),
    finalStatus: 'reviewed',
  })),
}
const tournament = {
  ...unsignedTournament,
  manifestHash: canonicalHash(unsignedTournament),
}
const selection = {
  version: selectionManifestVersion,
  candidateId: 'deepseek-pro-gemini-flash',
  writerId: 'deepseek-v4-pro',
  annotatorId: 'google/gemini-3.6-flash',
  tournamentManifestHash: tournament.manifestHash,
  approvedAt: '2026-07-20T12:00:00.000Z',
  approvedBy: 'reviewer',
  termsReviewReference: 'terms-2026-07',
} as const

function partition(stage: 'training_seed' | 'development_challenge') {
  const documents = corpusStageSpecs(stage).map((spec, index) => ({
    id: spec.id,
    textHash: `${index}`.padStart(64, stage === 'training_seed' ? 'a' : 'c'),
    recordHash: `${index}`.padStart(64, stage === 'training_seed' ? 'b' : 'd'),
  }))
  const signatures = corpusStageSpecs(stage).map((spec, index) => ({
    id: spec.id,
    textHash: `${index}`.padStart(64, stage === 'training_seed' ? 'a' : 'c'),
    shingles: [`fictional ${stage} document ${index}`],
  }))
  return partitionManifest(stage, documents, signatures)
}
const training = partition('training_seed')
const development = partition('development_challenge')

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

  it('rejects tampered, incomplete, unknown, and stale selection evidence', () => {
    expect(() =>
      assertSelectionManifest({ ...selection, candidateId: 'unknown' }),
    ).toThrow('unknown')
    expect(() =>
      assertSelectionManifest({ ...selection, writerId: 'different' }),
    ).toThrow('model IDs')
    expect(() =>
      assertTournamentManifest({ ...tournament, candidates: [{}] }),
    ).toThrow('stale')
    const incomplete = {
      ...unsignedTournament,
      candidates: unsignedTournament.candidates.slice(1),
    }
    expect(() =>
      assertTournamentManifest({
        ...incomplete,
        manifestHash: canonicalHash(incomplete),
      }),
    ).toThrow('every reviewed candidate')
  })

  it('finalizes a pending blind tournament into bound tournament and selection manifests', () => {
    const pendingUnsigned = {
      ...unsignedTournament,
      candidates: unsignedTournament.candidates.map((candidate) => {
        const { blindReviewScorecardHash: _, ...pendingCandidate } = candidate
        return { ...pendingCandidate, finalStatus: 'pending_review' as const }
      }),
    }
    const pending = {
      ...pendingUnsigned,
      manifestHash: canonicalHash(pendingUnsigned),
    }
    const finalized = finalizeTournament(pending, {
      tournamentManifestHash: pending.manifestHash,
      reviews: pending.candidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        blindReviewPackage: blindPackages[index]!,
        completedScorecard: scorecard,
        finalStatus: index === 1 ? 'rejected' : 'reviewed',
      })),
      selectedCandidateId: 'deepseek-pro-gemini-flash',
      approvedAt: '2026-07-20T12:00:00.000Z',
      approvedBy: 'reviewer',
      termsReviewReference: 'terms-2026-07',
    })
    expect(finalized.selection.tournamentManifestHash).toBe(
      finalized.tournament.manifestHash,
    )
    expect(() => {
      assertSelectionManifest(finalized.selection)
      assertTournamentManifest(finalized.tournament)
      requireSelection('benchmark', finalized.selection, finalized.tournament)
    }).not.toThrow()
    const tamperedPackage = {
      ...blindPackages[0]!,
      documents: [{ ...blindPackages[0]!.documents[0]!, text: 'Altered.' }],
    }
    expect(() =>
      finalizeTournament(pending, {
        tournamentManifestHash: pending.manifestHash,
        reviews: pending.candidates.map((candidate, index) => ({
          candidateId: candidate.candidateId,
          blindReviewPackage:
            index === 0 ? tamperedPackage : blindPackages[index]!,
          completedScorecard: scorecard,
          finalStatus: 'reviewed' as const,
        })),
        selectedCandidateId: 'deepseek-pro-gemini-flash',
        approvedAt: '2026-07-20T12:00:00.000Z',
        approvedBy: 'reviewer',
        termsReviewReference: 'terms-2026-07',
      }),
    ).toThrow('invalid blind review evidence')
    expect(() =>
      finalizeTournament(pending, {
        tournamentManifestHash: pending.manifestHash,
        reviews: [],
        selectedCandidateId: 'deepseek-pro-gemini-flash',
        approvedAt: '2026-07-20T12:00:00.000Z',
        approvedBy: 'reviewer',
        termsReviewReference: 'terms-2026-07',
      }),
    ).toThrow('review every eligible candidate')
  })

  it('enforces complete, stage-aware prior partition registries', () => {
    const first = partitionRegistry('training_seed', [])
    expect(first.noPriorPartitions).toBe(true)
    expect(() =>
      assertExternalPartitionRegistry(first, 'training_seed'),
    ).not.toThrow()

    expect(() =>
      partitionRegistry('development_challenge', [training]),
    ).not.toThrow()
    expect(() => partitionRegistry('benchmark', [training])).toThrow(
      'required prior stages',
    )
    const registry = partitionRegistry('benchmark', [training, development])
    expect(() =>
      assertExternalPartitionRegistry(registry, 'benchmark'),
    ).not.toThrow()
    expect(() =>
      assertExternalPartitionRegistry(registry, 'training_seed'),
    ).toThrow('invalid stage entries')
  })

  it('rejects truncated, mismatched, and unusable partition evidence', () => {
    expect(() =>
      partitionRegistry('development_challenge', [
        partitionManifest(
          'training_seed',
          training.documents.slice(1),
          training.nearDuplicateSignatures.slice(1),
        ),
      ]),
    ).toThrow('expected finalized specifications')
    expect(() =>
      partitionRegistry('development_challenge', [
        partitionManifest(
          'training_seed',
          training.documents,
          training.nearDuplicateSignatures.map((signature, index) =>
            index === 0
              ? { ...signature, textHash: 'f'.repeat(64) }
              : signature,
          ),
        ),
      ]),
    ).toThrow('signature')
    expect(() =>
      partitionRegistry('development_challenge', [
        partitionManifest(
          'training_seed',
          training.documents,
          training.nearDuplicateSignatures.map((signature, index) =>
            index === 0 ? { ...signature, shingles: [] } : signature,
          ),
        ),
      ]),
    ).toThrow('signature')
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
