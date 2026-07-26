import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootSentinelFile } from './artifacts'
import {
  canonicalHash,
  partitionManifest,
  partitionRegistry,
  reviewedCandidates,
  type ExternalPartitionRegistry,
  type SelectionManifest,
} from './governance'
import { generationSpecIdentity } from './matrix'
import { corpusStageSpecs, type CorpusStage } from './program'
import {
  humanAdjudicationEvidenceHash,
  type JudgeVerdict,
  type QaEvidence,
} from './qa'
import {
  main,
  pendingAdjudicationArtifact,
  type DocumentProcessingState,
  type RunCheckpointMetadata,
} from './run'
import type {
  DocumentSpec,
  RequestTelemetry,
  SyntheticDocument,
  SyntheticSpan,
} from './types'
import { contentHash } from './validation'

export type RunStage = Exclude<CorpusStage, 'tournament'>

export type PendingFixture = {
  artifact: ReturnType<typeof pendingAdjudicationArtifact>
  disposition: {
    id: string
    decision: 'approved'
    reviewer: string
    adjudicatedAt: string
    rationale: string
    referenceSpans: SyntheticSpan[]
    evidenceHash: string
  }
  metadata: RunCheckpointMetadata
  qa: Map<string, QaEvidence>
  registry: ExternalPartitionRegistry
}

export function state(
  id: string,
  status: DocumentProcessingState['status'],
): DocumentProcessingState {
  return {
    id,
    status,
    generationAttempts: 1,
    annotationAttempts: 1,
    repairAttempts: 0,
    regenerationAttempts: 0,
    qaAttempts: 1,
    transitions: [{ phase: 'judge' }],
    telemetryRequestIds: [`request-${id}`],
  }
}

export function verdict(
  id: string,
  referenceSpans: SyntheticSpan[],
  overrides: Partial<JudgeVerdict> = {},
): JudgeVerdict {
  return {
    id,
    allProposedSpansCorrect: true,
    hardNegativesCorrect: true,
    hardNegativeAssertions: [],
    referenceSpans,
    obviousUnmarkedSpans: [],
    realismScore: 5,
    confidence: 1,
    rationale: `fixture ${id}`,
    ...overrides,
  }
}

export function acceptedEvidence(document: SyntheticDocument): QaEvidence {
  const primary = verdict(document.id, document.spans)
  return {
    primary,
    dispute: { ...primary },
    escalationReasons: [],
    outcome: 'accepted',
    accepted: true,
    adjudicatedReference: {
      source: 'independent_judge_agreement',
      spans: document.spans,
    },
  }
}

export function pendingEvidence(
  document: SyntheticDocument,
  referenceSpans: SyntheticSpan[],
) {
  const primary = verdict(document.id, [], {
    allProposedSpansCorrect: false,
    rationale: 'primary fixture disagreement',
  })
  const dispute = verdict(document.id, referenceSpans, {
    allProposedSpansCorrect: false,
    rationale: 'dispute fixture disagreement',
  })
  const evidence: QaEvidence = {
    primary,
    dispute,
    escalationReasons: ['primary_rejection'],
    outcome: 'human_adjudication_required',
    accepted: false,
  }
  return {
    evidence,
    disposition: {
      id: document.id,
      decision: 'approved' as const,
      reviewer: 'fixture reviewer',
      adjudicatedAt: '2026-07-21T12:00:00.000Z',
      rationale: 'fixture adjudication',
      referenceSpans,
      evidenceHash: humanAdjudicationEvidenceHash(document, primary, dispute),
    },
  }
}

export function documentForSpec(spec: DocumentSpec): SyntheticDocument {
  const values = spec.requiredCategories.map(
    (category) => `fixture-${spec.id}-${category}`,
  )
  const text = [
    ...values,
    ...spec.hardNegatives.map((item) => item.quote),
  ].join(' ')
  let cursor = 0
  const spans = spec.requiredCategories.map((category, index) => {
    const value = values[index]!
    const start = cursor
    cursor += value.length + 1
    return { category, start, end: start + value.length, text: value }
  })
  return {
    id: spec.id,
    text,
    spans,
    generator: 'fixture:writer',
    specCell: generationSpecIdentity(spec),
    matrixCells: spec.matrixCells,
    contentHash: contentHash(text),
    hardNegatives: spec.hardNegatives,
  }
}

function minimalDocument(spec: DocumentSpec): SyntheticDocument {
  const text = `fixture source ${spec.id}`
  return {
    id: spec.id,
    text,
    spans: [],
    generator: 'fixture:writer',
    specCell: 'fixture',
    matrixCells: [],
    contentHash: contentHash(text),
    hardNegatives: [],
  }
}

function priorPartition(stage: 'training_seed' | 'development_challenge') {
  const documents = corpusStageSpecs(stage).map((spec) => {
    const textHash = contentHash(`prior ${stage} ${spec.id}`)
    return {
      id: spec.id,
      textHash,
      recordHash: contentHash(`record ${stage} ${spec.id}`),
    }
  })
  return partitionManifest(
    stage,
    documents,
    documents.map((document) => ({
      id: document.id,
      textHash: document.textHash,
      shingles: [`prior-${stage}-${document.id}`],
    })),
  )
}

function registryFor(stage: RunStage) {
  const training = priorPartition('training_seed')
  switch (stage) {
    case 'training_seed':
      return partitionRegistry(stage, [])
    case 'development_challenge':
      return partitionRegistry(stage, [training])
    case 'benchmark':
      return partitionRegistry(stage, [
        training,
        priorPartition('development_challenge'),
      ])
  }
}

function selection(tournamentManifestHash: string): SelectionManifest {
  return {
    version: 'synthetic-v2-selection:v1',
    candidateId: 'deepseek-pro-sonnet',
    writerId: 'deepseek-v4-pro',
    annotatorId: 'anthropic/claude-sonnet-4.6',
    tournamentManifestHash,
    approvedAt: '2026-07-21T12:00:00.000Z',
    approvedBy: 'fixture approver',
    termsReviewReference: 'fixture-terms',
  }
}

export function genericFixture(
  stage: RunStage,
  validDocuments = false,
): PendingFixture {
  const specs = corpusStageSpecs(stage)
  const completed = specs.map((spec) =>
    validDocuments ? documentForSpec(spec) : minimalDocument(spec),
  )
  const finalizedPending = completed.at(-1)!
  const pending = { ...finalizedPending, spans: [] }
  const accepted = completed.slice(0, -1)
  const { evidence, disposition } = pendingEvidence(
    pending,
    finalizedPending.spans,
  )
  const qa = new Map<string, QaEvidence>(
    accepted.map((document) => [document.id, acceptedEvidence(document)]),
  )
  qa.set(pending.id, evidence)
  const allDocuments = [...accepted, pending]
  const documentStates = allDocuments.map((document) =>
    state(
      document.id,
      document.id === pending.id ? 'human_adjudication_required' : 'accepted',
    ),
  )
  const registry = registryFor(stage)
  const tournamentManifestHash = 'd'.repeat(64)
  const telemetry: RequestTelemetry[] = [
    {
      requestId: `request-${stage}`,
      specId: allDocuments[0]!.id,
      role: 'writer',
      requestedModel: 'deepseek-v4-pro',
      returnedModel: 'deepseek-v4-pro',
      usage: { inputTokens: 10, outputTokens: 20 },
      latencyMs: 12,
      status: 'success',
      attempt: 1,
    },
  ]
  const metadata: RunCheckpointMetadata = {
    version: 'synthetic-v2-run:v2',
    stage,
    selection: selection(tournamentManifestHash),
    tournamentManifestHash,
    qa: [...qa],
    firstPassAnnotations: allDocuments.map((document) => [
      document.id,
      document.spans,
    ]),
    finalPassAnnotations: allDocuments.map((document) => [
      document.id,
      document.spans,
    ]),
    documentStates,
    usage: { inputTokens: 100, outputTokens: 200 },
    spendGbp: 0.123456,
    requestTelemetry: telemetry,
    partitionRegistryHash: canonicalHash(registry),
    externalPartitionHashes: registry.partitions.map((entry) =>
      canonicalHash(entry.manifest),
    ),
  }
  return {
    artifact: pendingAdjudicationArtifact(
      stage,
      specs.map((spec) => spec.id),
      metadata,
      accepted,
      [{ document: pending, evidence, state: documentStates.at(-1)! }],
    ),
    disposition,
    metadata,
    qa,
    registry,
  }
}

export async function privateRoot(directories: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-private-'))
  directories.push(root)
  await writeFile(
    join(root, rootSentinelFile),
    JSON.stringify({ kind: 'private-corpus' }),
  )
  return root
}

export async function releaseRoot(directories: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-release-'))
  directories.push(root)
  await writeFile(
    join(root, rootSentinelFile),
    JSON.stringify({ kind: 'benchmark-release' }),
  )
  return root
}

export async function invokeRunner(arguments_: string[], root: string) {
  const originalArgv = process.argv
  const originalRoot = process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT
  process.argv = ['node', 'scripts/synthetic-v2/run.ts', ...arguments_]
  process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT = root
  try {
    return await main()
  } finally {
    process.argv = originalArgv
    if (originalRoot === undefined)
      delete process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT
    else process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT = originalRoot
  }
}

export function recordEntry(value: unknown, id: string) {
  if (!Array.isArray(value)) throw new Error('Expected tuple entries')
  const entry = value.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === id,
  )
  if (!entry || !isRecord(entry[1]))
    throw new Error(`Missing ${id} metadata entry`)
  return entry[1]
}

export function stateEntry(value: unknown, id: string) {
  if (!Array.isArray(value)) throw new Error('Expected state entries')
  const entry = value.find(
    (candidate) => isRecord(candidate) && candidate.id === id,
  )
  if (!isRecord(entry)) throw new Error(`Missing ${id} state`)
  return entry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export { reviewedCandidates }
