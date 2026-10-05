import { assertSelectionManifest, canonicalHash } from './governance'
import { validateSpans } from './markers'
import { corpusStageSpecs, isCorpusStage, type CorpusStage } from './program'
import type {
  PendingAdjudication,
  PendingAdjudicationArtifact,
  PendingAdjudicationMetadata,
  RunCheckpointMetadata,
  RunStage,
  TournamentCandidateCheckpointMetadata,
} from './checkpoints'
import type { SyntheticDocument } from './types'
import {
  isDocumentProcessingState,
  isHash,
  isHashArray,
  isPendingAdjudication,
  isQaEvidence,
  isRequestTelemetry,
  isRunStage,
  isSyntheticDocument,
  isSyntheticSpan,
  isTournamentCandidateIdentity,
  isUsage,
  sameIdentifiers,
} from './checkpoint-guards'

export function assertPendingAdjudicationArtifact(
  artifact: unknown,
): asserts artifact is PendingAdjudicationArtifact {
  if (!isRecord(artifact))
    throw new Error('Pending adjudication artifact is stale or invalid')
  const { artifactHash, ...unsigned } = artifact
  if (
    artifact.version !== 'synthetic-v2-pending-adjudication:v3' ||
    typeof artifact.stage !== 'string' ||
    !isCorpusStage(artifact.stage) ||
    typeof artifactHash !== 'string' ||
    canonicalHash(unsigned) !== artifactHash ||
    !Array.isArray(artifact.expectedSpecificationIds) ||
    !Array.isArray(artifact.accepted) ||
    !Array.isArray(artifact.pending)
  )
    throw new Error('Pending adjudication artifact is stale or invalid')
  const pending = artifact.pending.map((entry) => {
    if (!isPendingAdjudication(entry))
      throw new Error('Pending adjudication artifact is stale or invalid')
    return entry
  })
  if (!pending.length) throw new Error('Pending adjudication artifact is empty')
  assertCheckpointContents(
    artifact.stage,
    artifact.expectedSpecificationIds,
    artifact.metadata,
    artifact.accepted,
    pending,
  )
}

export function assertRunCheckpointMetadata(
  metadata: unknown,
  stage?: RunStage,
): asserts metadata is RunCheckpointMetadata {
  if (!isRecord(metadata) || metadata.version !== 'synthetic-v2-run:v2')
    throw new Error('Pending adjudication artifact has invalid run provenance')
  if (!isRunStage(metadata.stage) || (stage && metadata.stage !== stage))
    throw new Error('Pending adjudication artifact has an invalid run stage')
  assertSelectionManifest(metadata.selection)
  if (
    !isHash(metadata.tournamentManifestHash) ||
    metadata.selection.tournamentManifestHash !==
      metadata.tournamentManifestHash ||
    !Array.isArray(metadata.qa) ||
    !Array.isArray(metadata.firstPassAnnotations) ||
    !Array.isArray(metadata.finalPassAnnotations) ||
    !Array.isArray(metadata.documentStates) ||
    !isUsage(metadata.usage) ||
    !isNonNegativeNumber(metadata.spendGbp) ||
    !Array.isArray(metadata.requestTelemetry) ||
    !isHash(metadata.partitionRegistryHash) ||
    !isHashArray(metadata.externalPartitionHashes)
  )
    throw new Error(
      'Pending adjudication artifact has incomplete run provenance',
    )
}

export function assertTournamentCandidateCheckpointMetadata(
  metadata: unknown,
): asserts metadata is TournamentCandidateCheckpointMetadata {
  if (
    !isRecord(metadata) ||
    metadata.version !== 'synthetic-v2-tournament-candidate:v1' ||
    metadata.stage !== 'tournament' ||
    !isTournamentCandidateIdentity(metadata.candidate) ||
    !Array.isArray(metadata.qa) ||
    !Array.isArray(metadata.firstPassAnnotations) ||
    !Array.isArray(metadata.finalPassAnnotations) ||
    !Array.isArray(metadata.documentStates) ||
    !isUsage(metadata.usage) ||
    !isNonNegativeNumber(metadata.spendGbp) ||
    !Array.isArray(metadata.requestTelemetry)
  )
    throw new Error(
      'Pending adjudication artifact has incomplete tournament candidate provenance',
    )
  const expected = corpusStageSpecs('tournament')
  if (
    !sameIdentifiers(
      metadata.candidate.specificationIds,
      expected.map((spec) => spec.id),
    ) ||
    !sameIdentifiers(
      metadata.candidate.seeds,
      expected.map((spec) => spec.seed),
    )
  )
    throw new Error(
      'Pending adjudication artifact has an invalid tournament candidate specification binding',
    )
}

export function assertCheckpointContents(
  stage: CorpusStage,
  expectedSpecificationIds: unknown,
  metadata: unknown,
  accepted: unknown,
  pending: PendingAdjudication[],
) {
  assertExpectedSpecificationIds(stage, expectedSpecificationIds)
  if (!Array.isArray(accepted))
    throw new Error('Pending adjudication artifact has invalid documents')
  const documents = [
    ...accepted.map((document) => {
      if (!isSyntheticDocument(document))
        throw new Error('Pending adjudication artifact has invalid documents')
      return document
    }),
    ...pending.map((entry) => entry.document),
  ]
  assertCompleteStageDocuments(stage, documents)
  assertCheckpointMetadata(metadata, stage, documents, pending)
}

function assertCheckpointMetadata(
  metadata: unknown,
  stage: CorpusStage,
  documents: SyntheticDocument[],
  pending: PendingAdjudication[],
): asserts metadata is PendingAdjudicationMetadata {
  if (stage === 'tournament')
    assertTournamentCandidateCheckpointMetadata(metadata)
  else assertRunCheckpointMetadata(metadata, stage)
  assertCommonProvenance(metadata, documents, pending)
}

function assertCommonProvenance(
  metadata: PendingAdjudicationMetadata,
  documents: SyntheticDocument[],
  pending: PendingAdjudication[],
) {
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  )
  const ids = new Set(documentsById.keys())
  assertQaEntries(metadata.qa, ids)
  assertAnnotationEntries(metadata.firstPassAnnotations, documentsById)
  assertAnnotationEntries(metadata.finalPassAnnotations, documentsById)
  assertDocumentStates(metadata.documentStates, ids)
  if (!metadata.requestTelemetry.every(isRequestTelemetry))
    throw new Error(
      'Pending adjudication artifact has invalid request telemetry',
    )
  if (metadata.requestTelemetry.some((entry) => !ids.has(entry.specId)))
    throw new Error(
      'Pending adjudication artifact has foreign request telemetry',
    )

  const qaById = new Map(metadata.qa)
  const stateById = new Map(
    metadata.documentStates.map((state) => [state.id, state]),
  )
  const pendingById = new Map(
    pending.map((entry) => [entry.document.id, entry]),
  )
  for (const document of documents) {
    const qa = qaById.get(document.id)
    const state = stateById.get(document.id)
    if (!qa || !state)
      throw new Error('Pending adjudication artifact is incomplete')
    if (
      qa.primary.id !== document.id ||
      (qa.dispute && qa.dispute.id !== document.id) ||
      (qa.human && qa.human.id !== document.id)
    )
      throw new Error(
        'Pending adjudication artifact has mismatched QA evidence',
      )
    const pendingEntry = pendingById.get(document.id)
    if (pendingEntry) {
      if (
        state.status !== 'human_adjudication_required' ||
        canonicalHash(qa) !== canonicalHash(pendingEntry.evidence) ||
        canonicalHash(state) !== canonicalHash(pendingEntry.state)
      )
        throw new Error(
          'Pending adjudication artifact does not bind its pending evidence',
        )
      continue
    }
    if (
      state.status !== 'accepted' ||
      !qa.accepted ||
      !qa.adjudicatedReference ||
      canonicalHash(document.spans) !==
        canonicalHash(qa.adjudicatedReference.spans)
    )
      throw new Error(
        'Pending adjudication artifact does not bind accepted provenance',
      )
  }
}

function assertExpectedSpecificationIds(stage: CorpusStage, value: unknown) {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
    throw new Error('Pending adjudication artifact has invalid specifications')
  if (
    !sameIdentifiers(
      value,
      corpusStageSpecs(stage).map((spec) => spec.id),
    )
  )
    throw new Error(
      'Pending adjudication artifact does not bind the actual stage specifications',
    )
}

function assertCompleteStageDocuments(
  stage: CorpusStage,
  documents: SyntheticDocument[],
) {
  const expected = corpusStageSpecs(stage).map((spec) => spec.id)
  if (
    !sameIdentifiers(
      documents.map((document) => document.id),
      expected,
    )
  )
    throw new Error(
      'Pending adjudication artifact does not contain every specification',
    )
}

function assertQaEntries(value: unknown, ids: Set<string>) {
  if (!Array.isArray(value))
    throw new Error('Pending adjudication artifact has invalid QA evidence')
  assertEntries(value, ids, 'QA evidence', isQaEvidence)
}

function assertAnnotationEntries(
  value: unknown,
  documentsById: Map<string, SyntheticDocument>,
) {
  if (!Array.isArray(value))
    throw new Error('Pending adjudication artifact has invalid prediction maps')
  const ids = new Set(documentsById.keys())
  assertEntries(value, ids, 'prediction maps', (spans, id) => {
    if (!Array.isArray(spans) || !spans.every(isSyntheticSpan)) return false
    const document = documentsById.get(id)
    if (!document) return false
    try {
      validateSpans(document.text, spans)
      return true
    } catch {
      return false
    }
  })
}

function assertDocumentStates(value: unknown, ids: Set<string>) {
  if (!Array.isArray(value))
    throw new Error('Pending adjudication artifact has invalid document states')
  const states = new Map<string, PendingAdjudication['state']>()
  for (const state of value) {
    if (
      !isDocumentProcessingState(state) ||
      !ids.has(state.id) ||
      states.has(state.id)
    )
      throw new Error(
        'Pending adjudication artifact has invalid document states',
      )
    states.set(state.id, state)
  }
  if (states.size !== ids.size)
    throw new Error(
      'Pending adjudication artifact has incomplete document states',
    )
}

function assertEntries(
  entries: unknown[],
  ids: Set<string>,
  label: string,
  validateValue: (value: unknown, id: string) => boolean,
) {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !ids.has(entry[0]) ||
      seen.has(entry[0]) ||
      !validateValue(entry[1], entry[0])
    )
      throw new Error(`Pending adjudication artifact has invalid ${label}`)
    seen.add(entry[0])
  }
  if (seen.size !== ids.size)
    throw new Error(`Pending adjudication artifact has incomplete ${label}`)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
