import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSelectionManifest,
  assertTournamentManifest,
  canonicalHash,
  tournamentManifestVersion,
  type TournamentManifest,
} from './governance'
import { finalizeTournamentFromFiles } from './promote'
import { corpusStageSpecs } from './program'
import {
  assertTournamentCandidateContinuation,
  pendingAdjudicationArtifact,
  type TournamentCandidateCheckpointMetadata,
} from './run'
import type { QaEvidence } from './qa'
import {
  acceptedEvidence,
  documentForSpec,
  invokeRunner,
  pendingEvidence,
  privateRoot,
  recordEntry,
  reviewedCandidates,
  state,
  stateEntry,
} from './resume.fixtures'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe.sequential('tournament candidate resume integration', () => {
  it('resumes a hash-bound candidate into a finalizable continuation without writing root/tournament', async () => {
    const root = await privateRoot(directories)
    const specs = corpusStageSpecs('tournament')
    const finalized = specs.map(documentForSpec)
    const finalizedPending = finalized[0]!
    const pending = { ...finalizedPending, spans: [] }
    const accepted = finalized.slice(1)
    const { evidence, disposition } = pendingEvidence(
      pending,
      finalizedPending.spans,
    )
    const qa = new Map<string, QaEvidence>(
      accepted.map((document) => [document.id, acceptedEvidence(document)]),
    )
    qa.set(pending.id, evidence)
    const documentStates = [
      state(pending.id, 'human_adjudication_required'),
      ...accepted.map((document) => state(document.id, 'accepted')),
    ]
    const candidate = reviewedCandidates[0]!
    const checkpointMetadata: TournamentCandidateCheckpointMetadata = {
      version: 'synthetic-v2-tournament-candidate:v1',
      stage: 'tournament',
      candidate: {
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        blindId: 'review-1',
        specificationIds: specs.map((spec) => spec.id),
        seeds: specs.map((spec) => spec.seed),
      },
      qa: [...qa],
      firstPassAnnotations: [pending, ...accepted].map((document) => [
        document.id,
        document.spans,
      ]),
      finalPassAnnotations: [pending, ...accepted].map((document) => [
        document.id,
        document.spans,
      ]),
      documentStates,
      usage: { inputTokens: 240, outputTokens: 480 },
      spendGbp: 0.456789,
      requestTelemetry: [
        {
          requestId: 'tournament-request',
          specId: pending.id,
          role: 'annotator',
          requestedModel: candidate.annotator,
          returnedModel: candidate.annotator,
          usage: { inputTokens: 10, outputTokens: 20 },
          latencyMs: 14,
          status: 'success',
          attempt: 1,
        },
      ],
    }
    const checkpoint = pendingAdjudicationArtifact(
      'tournament',
      specs.map((spec) => spec.id),
      checkpointMetadata,
      accepted,
      [{ document: pending, evidence, state: documentStates[0]! }],
    )
    const sourceUnsigned: Omit<TournamentManifest, 'manifestHash'> = {
      version: tournamentManifestVersion,
      candidates: reviewedCandidates.map((entry, index) => ({
        candidateId: entry.id,
        blindId: `review-${index + 1}`,
        specificationIds: specs.map((spec) => spec.id),
        seeds: specs.map((spec) => spec.seed),
        canonicalArtifactHash:
          index === 0 ? checkpoint.artifactHash : String(index).repeat(64),
        blindReviewPackageHash: canonicalHash({ status: 'ineligible' }),
        finalStatus:
          index === 0
            ? ('human_adjudication_required' as const)
            : ('rejected' as const),
      })),
    }
    const sourceTournament = {
      ...sourceUnsigned,
      manifestHash: canonicalHash(sourceUnsigned),
    }
    assertTournamentManifest(sourceTournament)

    const checkpointPath = join(root, 'candidate-checkpoint.json')
    const dispositionsPath = join(root, 'candidate-dispositions.json')
    const tournamentPath = join(root, 'source-tournament.json')
    await Promise.all([
      writeFile(checkpointPath, JSON.stringify(checkpoint)),
      writeFile(dispositionsPath, JSON.stringify([disposition])),
      writeFile(tournamentPath, JSON.stringify(sourceTournament)),
      mkdir(join(root, 'tournament'), { recursive: true }),
    ])
    const markerPath = join(root, 'tournament', 'immutable-marker')
    await writeFile(markerPath, 'original tournament artifact')

    const mismatchedUnsigned = {
      ...sourceUnsigned,
      candidates: sourceUnsigned.candidates.map((entry, index) =>
        index === 0
          ? { ...entry, canonicalArtifactHash: 'a'.repeat(64) }
          : entry,
      ),
    }
    const mismatchedPath = join(root, 'mismatched-tournament.json')
    await writeFile(
      mismatchedPath,
      JSON.stringify({
        ...mismatchedUnsigned,
        manifestHash: canonicalHash(mismatchedUnsigned),
      }),
    )
    await expect(
      invokeRunner(
        [
          '--stage=tournament',
          `--resume-tournament-candidate=${checkpointPath}`,
          `--human-dispositions=${dispositionsPath}`,
          `--tournament-manifest=${mismatchedPath}`,
        ],
        root,
      ),
    ).rejects.toThrow('not bound')

    const arguments_ = [
      '--stage=tournament',
      `--resume-tournament-candidate=${checkpointPath}`,
      `--human-dispositions=${dispositionsPath}`,
      `--tournament-manifest=${tournamentPath}`,
    ]
    await invokeRunner(arguments_, root)

    expect(await readFile(markerPath, 'utf8')).toBe(
      'original tournament artifact',
    )
    expect(await readFile(tournamentPath, 'utf8')).toBe(
      JSON.stringify(sourceTournament),
    )
    const continuationDirectory = join(
      root,
      'pending-adjudication',
      'tournament-continuations',
    )
    const continuationFiles = await readdir(continuationDirectory)
    expect(continuationFiles).toHaveLength(1)
    const continuationPath = join(continuationDirectory, continuationFiles[0]!)
    const continuation = JSON.parse(await readFile(continuationPath, 'utf8'))
    assertTournamentCandidateContinuation(continuation)
    expect(continuation.sourceTournamentManifestHash).toBe(
      sourceTournament.manifestHash,
    )
    expect(continuation.pendingArtifactHash).toBe(checkpoint.artifactHash)
    const resumedCandidate = continuation.tournament.candidates[0]!
    expect(resumedCandidate.finalStatus).toBe('pending_review')
    expect(resumedCandidate.canonicalArtifactHash).toBe(
      canonicalHash(continuation.candidateArtifact),
    )
    expect(resumedCandidate.blindReviewPackageHash).toBe(
      canonicalHash(continuation.blindReviewPackage),
    )
    expect(continuation.candidateArtifact.documents).toHaveLength(specs.length)
    expect(continuation.candidateArtifact.candidate).toEqual(
      checkpointMetadata.candidate,
    )
    expect(continuation.candidateArtifact.usage).toEqual(
      checkpointMetadata.usage,
    )
    expect(continuation.candidateArtifact.spendGbp).toBe(
      checkpointMetadata.spendGbp,
    )
    expect(continuation.candidateArtifact.requestTelemetry).toEqual(
      checkpointMetadata.requestTelemetry,
    )
    expect(continuation.candidateArtifact.firstPassAnnotations).toEqual(
      checkpointMetadata.firstPassAnnotations,
    )
    expect(continuation.candidateArtifact.finalPassAnnotations).toEqual(
      checkpointMetadata.finalPassAnnotations,
    )
    expect(
      continuation.candidateArtifact.metrics.entity.overall.falseNegative,
    ).toBeGreaterThan(0)
    expect(
      recordEntry(continuation.candidateArtifact.qa, pending.id),
    ).toMatchObject({
      primary: evidence.primary,
      dispute: evidence.dispute,
      human: disposition,
    })
    expect(
      stateEntry(continuation.candidateArtifact.documentStates, pending.id)
        .status,
    ).toBe('accepted')

    await expect(invokeRunner(arguments_, root)).rejects.toThrow('EEXIST')

    const continuationTournamentPath = join(
      root,
      'continuation-tournament.json',
    )
    const finalizationPath = join(root, 'continuation-finalization.json')
    const outputPath = join(root, 'finalized-tournament')
    await Promise.all([
      writeFile(
        continuationTournamentPath,
        JSON.stringify(continuation.tournament),
      ),
      writeFile(
        finalizationPath,
        JSON.stringify({
          tournamentManifestHash: continuation.tournament.manifestHash,
          reviews: [
            {
              candidateId: resumedCandidate.candidateId,
              blindReviewPackage: continuation.blindReviewPackage,
              completedScorecard: {
                annotation_accuracy: 5,
                hard_negative_handling: 5,
                realism: 5,
              },
              finalStatus: 'reviewed',
            },
          ],
          selectedCandidateId: resumedCandidate.candidateId,
          approvedAt: '2026-07-21T12:00:00.000Z',
          approvedBy: 'fixture approver',
          termsReviewReference: 'fixture-terms',
        }),
      ),
    ])
    await finalizeTournamentFromFiles({
      tournamentManifestPath: continuationTournamentPath,
      finalizationPath,
      outputPath,
    })
    const [finalizedTournament, finalizedSelection] = await Promise.all([
      readFile(`${outputPath}.tournament.json`, 'utf8').then(JSON.parse),
      readFile(`${outputPath}.selection.json`, 'utf8').then(JSON.parse),
    ])
    expect(() => {
      assertTournamentManifest(finalizedTournament)
      assertSelectionManifest(finalizedSelection)
    }).not.toThrow()
  })
})
