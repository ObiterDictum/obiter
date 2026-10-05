import { resolve } from 'node:path'
import { assertSafeOutputRoot, writeText } from './artifacts'
import {
  assertBlindReviewPackage,
  assertTournamentManifest,
  blindReviewPackage,
  canonicalHash,
  tournamentManifestVersion,
  type BlindReviewPackage,
  type TournamentManifest,
} from './governance'
import { scoreAdjudicatedDocuments } from './scoring'
import {
  assertPendingAdjudicationArtifact,
  assertTournamentCandidateCheckpointMetadata,
  resumePendingAdjudications,
  type DocumentProcessingState,
  type PendingAdjudicationArtifact,
  type QaEntries,
  type TournamentCandidateCheckpointMetadata,
} from './checkpoints'
import type {
  RequestTelemetry,
  SyntheticDocument,
  SyntheticSpan,
  Usage,
} from './types'
import type { HumanAdjudication, QaEvidence } from './qa'

export type TournamentCandidateArtifact = {
  version: 'synthetic-v2-tournament-candidate:v2'
  candidate: TournamentCandidateCheckpointMetadata['candidate']
  resumedPendingArtifactHash: string
  documents: SyntheticDocument[]
  qa: QaEntries
  metrics: ReturnType<typeof scoreAdjudicatedDocuments>
  usage: Usage
  spendGbp: number
  requestTelemetry: RequestTelemetry[]
  documentStates: DocumentProcessingState[]
  firstPassAnnotations: Array<[string, SyntheticSpan[]]>
  finalPassAnnotations: Array<[string, SyntheticSpan[]]>
}

export type TournamentCandidateContinuation = {
  version: 'synthetic-v2-tournament-candidate-continuation:v1'
  sourceTournamentManifestHash: string
  pendingArtifactHash: string
  candidateArtifact: TournamentCandidateArtifact
  blindReviewPackage: BlindReviewPackage
  tournament: TournamentManifest
  continuationHash: string
}

export function resumeTournamentCandidate(
  artifact: PendingAdjudicationArtifact,
  dispositions: HumanAdjudication[],
  tournament: unknown,
) {
  assertPendingAdjudicationArtifact(artifact)
  if (artifact.stage !== 'tournament')
    throw new Error(
      'Tournament candidate resume requires a tournament checkpoint',
    )
  assertTournamentCandidateCheckpointMetadata(artifact.metadata)
  assertTournamentManifest(tournament)
  const metadata = artifact.metadata
  const candidate = tournament.candidates.find(
    (entry) => entry.candidateId === metadata.candidate.candidateId,
  )
  if (
    !candidate ||
    candidate.finalStatus !== 'human_adjudication_required' ||
    candidate.canonicalArtifactHash !== artifact.artifactHash ||
    candidate.blindId !== metadata.candidate.blindId ||
    !sameValues(
      candidate.specificationIds,
      metadata.candidate.specificationIds,
    ) ||
    !sameValues(candidate.seeds, metadata.candidate.seeds)
  )
    throw new Error(
      'Tournament candidate checkpoint is not bound to the supplied tournament manifest',
    )

  const resumed = resumePendingAdjudications(artifact, dispositions)
  if (resumed.rejected.length)
    throw new Error(
      'Human adjudication rejected one or more tournament documents',
    )
  assertTournamentCandidateCheckpointMetadata(resumed.metadata)
  const resumedMetadata = resumed.metadata
  const qa = new Map<string, QaEvidence>(resumedMetadata.qa)
  const finalPassAnnotations = new Map(resumedMetadata.finalPassAnnotations)
  const firstPassAnnotations = new Map(resumedMetadata.firstPassAnnotations)
  const candidateArtifact: TournamentCandidateArtifact = {
    version: 'synthetic-v2-tournament-candidate:v2',
    candidate: resumedMetadata.candidate,
    resumedPendingArtifactHash: artifact.artifactHash,
    documents: resumed.accepted,
    qa: resumedMetadata.qa,
    metrics: scoreAdjudicatedDocuments(
      resumed.accepted,
      qa,
      finalPassAnnotations,
      firstPassAnnotations,
    ),
    usage: resumedMetadata.usage,
    spendGbp: resumedMetadata.spendGbp,
    requestTelemetry: resumedMetadata.requestTelemetry,
    documentStates: resumedMetadata.documentStates,
    firstPassAnnotations: resumedMetadata.firstPassAnnotations,
    finalPassAnnotations: resumedMetadata.finalPassAnnotations,
  }
  const reviewPackage = blindReviewPackage(
    resumedMetadata.candidate.blindId,
    resumed.accepted,
  )
  const candidates = tournament.candidates.map((entry) => {
    if (entry.candidateId !== candidate.candidateId) return entry
    const { blindReviewScorecardHash: _, ...unscored } = entry
    return {
      ...unscored,
      canonicalArtifactHash: canonicalHash(candidateArtifact),
      blindReviewPackageHash: canonicalHash(reviewPackage),
      finalStatus: 'pending_review' as const,
    }
  })
  const unsignedTournament = {
    version: tournamentManifestVersion,
    candidates,
  }
  const resumedTournament = {
    ...unsignedTournament,
    manifestHash: canonicalHash(unsignedTournament),
  }
  assertTournamentManifest(resumedTournament)
  const unsigned = {
    version: 'synthetic-v2-tournament-candidate-continuation:v1' as const,
    sourceTournamentManifestHash: tournament.manifestHash,
    pendingArtifactHash: artifact.artifactHash,
    candidateArtifact,
    blindReviewPackage: reviewPackage,
    tournament: resumedTournament,
  }
  const continuation = {
    ...unsigned,
    continuationHash: canonicalHash(unsigned),
  }
  assertTournamentCandidateContinuation(continuation)
  return continuation
}

export async function persistTournamentCandidateContinuation(
  root: string,
  productRoot: string,
  continuation: TournamentCandidateContinuation,
) {
  assertTournamentCandidateContinuation(continuation)
  const approvedRoot = await assertSafeOutputRoot(
    root,
    productRoot,
    'private-corpus',
    'tournament',
  )
  const path = resolve(
    approvedRoot,
    'pending-adjudication',
    'tournament-continuations',
    `${continuation.continuationHash}.json`,
  )
  await writeText(path, `${JSON.stringify(continuation)}\n`)
  return path
}

export function assertTournamentCandidateContinuation(
  value: unknown,
): asserts value is TournamentCandidateContinuation {
  if (!isRecord(value))
    throw new Error('Tournament candidate continuation is invalid')
  const { continuationHash, ...unsigned } = value
  if (
    value.version !== 'synthetic-v2-tournament-candidate-continuation:v1' ||
    !isHash(value.sourceTournamentManifestHash) ||
    !isHash(value.pendingArtifactHash) ||
    !isHash(continuationHash) ||
    canonicalHash(unsigned) !== continuationHash
  )
    throw new Error('Tournament candidate continuation is stale or invalid')
  assertTournamentManifest(value.tournament)
  assertBlindReviewPackage(value.blindReviewPackage)
  const candidateArtifact = value.candidateArtifact
  assertTournamentCandidateArtifact(candidateArtifact)
  const candidate = value.tournament.candidates.find(
    (entry) => entry.candidateId === candidateArtifact.candidate.candidateId,
  )
  if (
    !candidate ||
    candidate.finalStatus !== 'pending_review' ||
    candidate.canonicalArtifactHash !== canonicalHash(candidateArtifact) ||
    candidate.blindReviewPackageHash !==
      canonicalHash(value.blindReviewPackage) ||
    candidate.blindId !== candidateArtifact.candidate.blindId ||
    !sameValues(
      candidate.specificationIds,
      candidateArtifact.candidate.specificationIds,
    ) ||
    !sameValues(candidate.seeds, candidateArtifact.candidate.seeds)
  )
    throw new Error('Tournament candidate continuation has invalid bindings')
}

function assertTournamentCandidateArtifact(
  value: unknown,
): asserts value is TournamentCandidateArtifact {
  if (
    !isRecord(value) ||
    value.version !== 'synthetic-v2-tournament-candidate:v2' ||
    !isHash(value.resumedPendingArtifactHash) ||
    !Array.isArray(value.documents) ||
    !Array.isArray(value.qa) ||
    !Array.isArray(value.firstPassAnnotations) ||
    !Array.isArray(value.finalPassAnnotations) ||
    !Array.isArray(value.documentStates) ||
    !Array.isArray(value.requestTelemetry) ||
    !isRecord(value.metrics) ||
    !isRecord(value.usage) ||
    typeof value.spendGbp !== 'number'
  )
    throw new Error(
      'Tournament candidate continuation has invalid candidate evidence',
    )
  const checkpointMetadata = {
    version: 'synthetic-v2-tournament-candidate:v1' as const,
    stage: 'tournament' as const,
    candidate: value.candidate,
    qa: value.qa,
    firstPassAnnotations: value.firstPassAnnotations,
    finalPassAnnotations: value.finalPassAnnotations,
    documentStates: value.documentStates,
    usage: value.usage,
    spendGbp: value.spendGbp,
    requestTelemetry: value.requestTelemetry,
  }
  assertTournamentCandidateCheckpointMetadata(checkpointMetadata)
  const candidate = checkpointMetadata.candidate
  if (
    value.documents.length !== candidate.specificationIds.length ||
    !sameValues(
      value.documents.map((document) =>
        isRecord(document) && typeof document.id === 'string'
          ? document.id
          : '',
      ),
      candidate.specificationIds,
    )
  )
    throw new Error(
      'Tournament candidate continuation has incomplete documents',
    )
}

function sameValues(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((entry) => expected.includes(entry))
  )
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
