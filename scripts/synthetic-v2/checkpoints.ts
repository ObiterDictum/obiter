import { resolve } from 'node:path'
import { assertSafeOutputRoot, writeText } from './artifacts'
import { canonicalHash, type SelectionManifest } from './governance'
import { corpusStageSpecs, type CorpusStage } from './program'
import {
  applyAdjudicatedReference,
  validateHumanAdjudication,
  type HumanAdjudication,
  type QaEvidence,
} from './qa'
import type { RequestTelemetry, SyntheticDocument, Usage } from './types'
import { contentHash } from './validation'
import {
  assertCheckpointContents,
  assertPendingAdjudicationArtifact,
} from './checkpoint-validation'

export {
  assertPendingAdjudicationArtifact,
  assertRunCheckpointMetadata,
  assertTournamentCandidateCheckpointMetadata,
} from './checkpoint-validation'

export type DocumentProcessingState = {
  id: string
  status:
    'accepted' | 'repair_required' | 'human_adjudication_required' | 'failed'
  generationAttempts: number
  annotationAttempts: number
  repairAttempts: number
  regenerationAttempts: number
  qaAttempts: number
  transitions: Array<{ phase: string; reason?: string }>
  telemetryRequestIds: string[]
}

export type AnnotationEntries = Array<[string, SyntheticDocument['spans']]>
export type QaEntries = Array<[string, QaEvidence]>
export type RunStage = Exclude<CorpusStage, 'tournament'>

export type RunCheckpointMetadata = {
  version: 'synthetic-v2-run:v2'
  stage: RunStage
  selection: SelectionManifest
  tournamentManifestHash: string
  qa: QaEntries
  firstPassAnnotations: AnnotationEntries
  finalPassAnnotations: AnnotationEntries
  documentStates: DocumentProcessingState[]
  usage: Usage
  spendGbp: number
  requestTelemetry: RequestTelemetry[]
  partitionRegistryHash: string
  externalPartitionHashes: string[]
}

export type TournamentCandidateCheckpointMetadata = {
  version: 'synthetic-v2-tournament-candidate:v1'
  stage: 'tournament'
  candidate: {
    candidateId: string
    writer: string
    annotator: string
    blindId: string
    specificationIds: string[]
    seeds: string[]
  }
  qa: QaEntries
  firstPassAnnotations: AnnotationEntries
  finalPassAnnotations: AnnotationEntries
  documentStates: DocumentProcessingState[]
  usage: Usage
  spendGbp: number
  requestTelemetry: RequestTelemetry[]
}

export type PendingAdjudicationMetadata =
  RunCheckpointMetadata | TournamentCandidateCheckpointMetadata

export type PendingAdjudication = {
  document: SyntheticDocument
  evidence: QaEvidence
  state: DocumentProcessingState
}

export type PendingAdjudicationArtifact = {
  version: 'synthetic-v2-pending-adjudication:v3'
  stage: CorpusStage
  expectedSpecificationIds: string[]
  metadata: PendingAdjudicationMetadata
  accepted: SyntheticDocument[]
  pending: PendingAdjudication[]
  artifactHash: string
}

export function pendingAdjudicationArtifact(
  stage: CorpusStage,
  expectedSpecificationIds: string[],
  metadata: PendingAdjudicationMetadata,
  accepted: SyntheticDocument[],
  pending: PendingAdjudication[],
): PendingAdjudicationArtifact {
  if (!pending.length) throw new Error('Pending adjudication artifact is empty')
  assertCheckpointContents(
    stage,
    expectedSpecificationIds,
    metadata,
    accepted,
    pending,
  )
  const unsigned = {
    version: 'synthetic-v2-pending-adjudication:v3' as const,
    stage,
    expectedSpecificationIds,
    metadata,
    accepted,
    pending,
  }
  return { ...unsigned, artifactHash: canonicalHash(unsigned) }
}

export function resumePendingAdjudications(
  artifact: PendingAdjudicationArtifact,
  dispositions: HumanAdjudication[],
) {
  assertPendingAdjudicationArtifact(artifact)
  const pending = new Map(
    artifact.pending.map((entry) => [entry.document.id, entry]),
  )
  if (pending.size !== artifact.pending.length)
    throw new Error('Pending adjudication artifact has duplicate documents')
  const dispositionsById = new Map(
    dispositions.map((disposition) => [disposition.id, disposition]),
  )
  if (
    dispositionsById.size !== dispositions.length ||
    dispositionsById.size !== pending.size
  )
    throw new Error(
      'Human dispositions do not exactly match pending adjudications',
    )

  const resolved = new Map<
    string,
    {
      evidence: QaEvidence
      state: DocumentProcessingState
      document?: SyntheticDocument
    }
  >()
  const rejected: string[] = []
  for (const [id, entry] of pending) {
    const human = dispositionsById.get(id)
    if (!human) throw new Error(`Missing human disposition for ${id}`)
    if (entry.document.contentHash !== contentHash(entry.document.text))
      throw new Error(`Pending adjudication document hash is invalid for ${id}`)
    if (!entry.evidence.dispute)
      throw new Error(`Pending adjudication lacks dispute evidence for ${id}`)
    validateHumanAdjudication(
      entry.document,
      entry.evidence.primary,
      entry.evidence.dispute,
      human,
    )
    const evidence: QaEvidence = {
      ...entry.evidence,
      human,
      outcome: human.decision === 'approved' ? 'accepted' : 'human_rejected',
      accepted: human.decision === 'approved',
      adjudicatedReference:
        human.decision === 'approved'
          ? { source: 'human', spans: human.referenceSpans }
          : undefined,
    }
    const status = human.decision === 'approved' ? 'accepted' : 'failed'
    const state: DocumentProcessingState = {
      ...entry.state,
      status,
      transitions: [
        ...entry.state.transitions,
        {
          phase: status === 'accepted' ? 'human_adjudicated' : 'human_rejected',
        },
      ],
    }
    if (human.decision === 'approved')
      resolved.set(id, {
        evidence,
        state,
        document: applyAdjudicatedReference(entry.document, evidence),
      })
    else {
      rejected.push(id)
      resolved.set(id, { evidence, state })
    }
  }

  const metadata = applyResolvedAdjudications(artifact.metadata, resolved)
  const documentsById = new Map<string, SyntheticDocument>(
    artifact.accepted.map((document) => [document.id, document]),
  )
  for (const [id, entry] of resolved)
    if (entry.document) documentsById.set(id, entry.document)
  const accepted: SyntheticDocument[] = []
  for (const id of corpusStageSpecs(artifact.stage).map((spec) => spec.id)) {
    const document = documentsById.get(id)
    if (document) accepted.push(document)
  }
  if (!rejected.length)
    assertCheckpointContents(
      artifact.stage,
      artifact.expectedSpecificationIds,
      metadata,
      accepted,
      [],
    )
  return { stage: artifact.stage, accepted, rejected, metadata }
}

export async function persistPendingAdjudications(
  root: string,
  productRoot: string,
  artifact: PendingAdjudicationArtifact,
) {
  assertPendingAdjudicationArtifact(artifact)
  const approvedRoot = await assertSafeOutputRoot(
    root,
    productRoot,
    'private-corpus',
    artifact.stage,
  )
  const destination = resolve(
    approvedRoot,
    'pending-adjudication',
    `${artifact.artifactHash}.json`,
  )
  await writeText(destination, `${JSON.stringify(artifact)}\n`)
  return destination
}

function applyResolvedAdjudications(
  metadata: PendingAdjudicationMetadata,
  resolved: Map<
    string,
    {
      evidence: QaEvidence
      state: DocumentProcessingState
      document?: SyntheticDocument
    }
  >,
): PendingAdjudicationMetadata {
  const qa: QaEntries = metadata.qa.map(([id, evidence]) => {
    const resolution = resolved.get(id)
    return [id, resolution?.evidence ?? evidence]
  })
  const documentStates = metadata.documentStates.map(
    (state) => resolved.get(state.id)?.state ?? state,
  )
  return { ...metadata, qa, documentStates }
}
