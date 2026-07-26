import { createHash } from 'node:crypto'
import { corpusStageSpecs, type CorpusStage } from './program'
import type { NearDuplicateSignature } from './validation'
import type { SyntheticDocument } from './types'

export const selectionManifestVersion = 'synthetic-v2-selection:v1'
export const tournamentManifestVersion = 'synthetic-v2-tournament:v1'
export const partitionRegistryVersion = 'synthetic-v2-partition-registry:v1'

export type Candidate = {
  id: string
  writer: string
  annotator: string
  reviewed: boolean
}

export const reviewedCandidates: Candidate[] = [
  {
    id: 'deepseek-pro-sonnet',
    writer: 'deepseek-v4-pro',
    annotator: 'anthropic/claude-sonnet-4.6',
    reviewed: true,
  },
  {
    id: 'deepseek-flash-sonnet',
    writer: 'deepseek-v4-flash',
    annotator: 'anthropic/claude-sonnet-4.6',
    reviewed: true,
  },
  {
    id: 'opus-sonnet',
    writer: 'anthropic/claude-opus-4.8',
    annotator: 'anthropic/claude-sonnet-4.6',
    reviewed: true,
  },
]

export type SelectionManifest = {
  version: typeof selectionManifestVersion
  candidateId: string
  writerId: string
  annotatorId: string
  tournamentManifestHash: string
  approvedAt: string
  approvedBy: string
  termsReviewReference: string
}

export type BlindReviewDocument = Omit<SyntheticDocument, 'generator'>

export type BlindReviewPackage = {
  version: 'synthetic-v2-blind-review:v1'
  blindId: string
  documents: BlindReviewDocument[]
  scorecard: {
    criteria: ['annotation_accuracy', 'hard_negative_handling', 'realism']
  }
}

export type TournamentCandidate = {
  candidateId: string
  blindId: string
  specificationIds: string[]
  seeds: string[]
  canonicalArtifactHash: string
  blindReviewPackageHash: string
  blindReviewScorecardHash?: string
  finalStatus:
    'pending_review' | 'human_adjudication_required' | 'reviewed' | 'rejected'
}

export type TournamentManifest = {
  version: typeof tournamentManifestVersion
  candidates: TournamentCandidate[]
  manifestHash: string
}

export type TournamentReview = {
  candidateId: string
  blindReviewPackage: BlindReviewPackage
  completedScorecard: Record<string, unknown>
  finalStatus: 'reviewed' | 'rejected'
}

export type TournamentFinalization = {
  tournamentManifestHash: string
  reviews: TournamentReview[]
  selectedCandidateId: string
  approvedAt: string
  approvedBy: string
  termsReviewReference: string
}

export type PartitionManifest = {
  stage: CorpusStage
  documents: Array<{ id: string; textHash: string; recordHash: string }>
  nearDuplicateSignatures: NearDuplicateSignature[]
  /** Canonical hash of this exact finalized partition manifest. */
  manifestHash: string
}

export type ExternalPartitionRegistry = {
  version: typeof partitionRegistryVersion
  /** Only permitted for the first non-tournament partition. */
  noPriorPartitions?: true
  partitions: Array<{
    stage: CorpusStage
    manifestHash: string
    manifest: PartitionManifest
  }>
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number')
    return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (Array.isArray(value))
    return `[${value
      .map((entry) => canonicalJson(entry === undefined ? null : entry))
      .join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .flatMap((key) => {
        const entry = record[key]
        return entry === undefined ||
          typeof entry === 'function' ||
          typeof entry === 'symbol'
          ? []
          : [`${JSON.stringify(key)}:${canonicalJson(entry)}`]
      })
      .join(',')}}`
  }
  throw new Error('Canonical JSON only accepts JSON values')
}

export function canonicalHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function assertSelectionManifest(
  value: unknown,
): asserts value is SelectionManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Selection manifest must be an object')
  const manifest = value as Partial<SelectionManifest>
  if (
    manifest.version !== selectionManifestVersion ||
    typeof manifest.candidateId !== 'string' ||
    typeof manifest.writerId !== 'string' ||
    typeof manifest.annotatorId !== 'string' ||
    typeof manifest.approvedBy !== 'string' ||
    manifest.approvedBy.trim().length === 0 ||
    typeof manifest.termsReviewReference !== 'string' ||
    manifest.termsReviewReference.trim().length === 0 ||
    !isHash(manifest.tournamentManifestHash) ||
    !isDate(manifest.approvedAt)
  )
    throw new Error('Selection manifest has invalid versioned approval fields')
  const candidate = candidateById(manifest.candidateId)
  if (!candidate?.reviewed)
    throw new Error('Selection manifest names an unknown reviewed candidate')
  if (
    candidate.writer !== manifest.writerId ||
    candidate.annotator !== manifest.annotatorId
  )
    throw new Error('Selection manifest model IDs do not match its candidate')
}

export function blindReviewPackage(
  blindId: string,
  documents: SyntheticDocument[],
): BlindReviewPackage {
  const review = {
    version: 'synthetic-v2-blind-review:v1' as const,
    blindId,
    documents: documents.map(({ generator: _, ...document }) => document),
    scorecard: {
      criteria: [
        'annotation_accuracy',
        'hard_negative_handling',
        'realism',
      ] as const,
    },
  }
  assertBlindReviewPackage(review)
  return review
}

export function assertTournamentManifest(
  value: unknown,
): asserts value is TournamentManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Tournament manifest must be an object')
  const manifest = value as Partial<TournamentManifest>
  if (
    manifest.version !== tournamentManifestVersion ||
    !Array.isArray(manifest.candidates) ||
    !isHash(manifest.manifestHash)
  )
    throw new Error('Tournament manifest has invalid versioned fields')
  const { manifestHash, ...unsigned } = manifest
  if (canonicalHash(unsigned) !== manifestHash)
    throw new Error('Tournament manifest hash is stale or tampered')
  if (manifest.candidates.length !== reviewedCandidates.length)
    throw new Error('Tournament manifest must include every reviewed candidate')
  const seen = new Set<string>()
  const blindIds = new Set<string>()
  for (const candidate of manifest.candidates) {
    if (
      !candidate ||
      !candidateById(candidate.candidateId)?.reviewed ||
      seen.has(candidate.candidateId) ||
      blindIds.has(candidate.blindId) ||
      !nonEmptyStrings(candidate.specificationIds) ||
      !nonEmptyStrings(candidate.seeds) ||
      candidate.specificationIds.length !== candidate.seeds.length ||
      !isHash(candidate.canonicalArtifactHash) ||
      !isBlindId(candidate.blindId) ||
      !isHash(candidate.blindReviewPackageHash) ||
      (candidate.blindReviewScorecardHash !== undefined &&
        !isHash(candidate.blindReviewScorecardHash)) ||
      (candidate.finalStatus === 'reviewed' &&
        !isHash(candidate.blindReviewScorecardHash)) ||
      ((candidate.finalStatus === 'pending_review' ||
        candidate.finalStatus === 'human_adjudication_required') &&
        candidate.blindReviewScorecardHash !== undefined) ||
      ![
        'pending_review',
        'human_adjudication_required',
        'reviewed',
        'rejected',
      ].includes(candidate.finalStatus)
    )
      throw new Error('Tournament manifest contains invalid candidate evidence')
    seen.add(candidate.candidateId)
    blindIds.add(candidate.blindId)
  }
}

/** Converts a complete blind review record into immutable tournament and selection manifests. */
export function finalizeTournament(tournament: unknown, finalization: unknown) {
  assertTournamentManifest(tournament)
  if (
    tournament.candidates.some(
      (candidate) => candidate.finalStatus === 'reviewed',
    )
  )
    throw new Error(
      'Tournament finalization cannot revise an already reviewed candidate',
    )
  if (
    tournament.candidates.some(
      (candidate) => candidate.finalStatus === 'human_adjudication_required',
    )
  )
    throw new Error(
      'Tournament finalization requires every human adjudication to be resumed first',
    )
  if (!isTournamentFinalization(finalization))
    throw new Error('Tournament finalization is not bound to a valid approval')
  if (finalization.tournamentManifestHash !== tournament.manifestHash)
    throw new Error('Tournament finalization is not bound to a valid approval')
  const reviews = new Map<string, TournamentReview>()
  for (const review of finalization.reviews) {
    const candidate =
      review &&
      tournament.candidates.find(
        (entry) => entry.candidateId === review.candidateId,
      )
    if (
      !review ||
      !candidate ||
      candidate.finalStatus !== 'pending_review' ||
      reviews.has(review.candidateId) ||
      !['reviewed', 'rejected'].includes(review.finalStatus) ||
      !isCompletedScorecard(review.completedScorecard) ||
      !isBlindReviewPackage(review.blindReviewPackage) ||
      review.blindReviewPackage.blindId !== candidate.blindId ||
      canonicalHash(review.blindReviewPackage) !==
        candidate.blindReviewPackageHash
    )
      throw new Error(
        'Tournament finalization contains invalid blind review evidence',
      )
    reviews.set(review.candidateId, review)
  }
  const pending = tournament.candidates.filter(
    (candidate) => candidate.finalStatus === 'pending_review',
  )
  if (reviews.size !== pending.length)
    throw new Error(
      'Tournament finalization must review every eligible candidate',
    )
  const candidates = tournament.candidates.map((candidate) => {
    if (candidate.finalStatus === 'rejected') return candidate
    const review = reviews.get(candidate.candidateId)
    if (!review)
      throw new Error(
        'Tournament finalization scorecard does not bind candidate',
      )
    return {
      ...candidate,
      blindReviewScorecardHash: canonicalHash(review.completedScorecard),
      finalStatus: review.finalStatus,
    }
  })
  const unsigned = { version: tournamentManifestVersion, candidates }
  const finalizedTournament = {
    ...unsigned,
    manifestHash: canonicalHash(unsigned),
  }
  const selected = candidates.find(
    (candidate) => candidate.candidateId === finalization.selectedCandidateId,
  )
  if (!selected || selected.finalStatus !== 'reviewed')
    throw new Error('Tournament selection must name a reviewed candidate')
  const selectedCandidate = candidateById(selected.candidateId)!
  return {
    tournament: finalizedTournament,
    selection: {
      version: selectionManifestVersion as typeof selectionManifestVersion,
      candidateId: selected.candidateId,
      writerId: selectedCandidate.writer,
      annotatorId: selectedCandidate.annotator,
      tournamentManifestHash: finalizedTournament.manifestHash,
      approvedAt: finalization.approvedAt,
      approvedBy: finalization.approvedBy,
      termsReviewReference: finalization.termsReviewReference,
    },
  }
}

export function requireSelection(
  stage: CorpusStage,
  manifest: SelectionManifest | undefined,
  tournament?: TournamentManifest,
) {
  if (stage === 'tournament') return
  if (!manifest)
    throw new Error(
      `Stage ${stage} requires an approved reviewed candidate selection manifest`,
    )
  assertSelectionManifest(manifest)
  if (!tournament)
    throw new Error(`Stage ${stage} requires its canonical tournament manifest`)
  assertTournamentManifest(tournament)
  if (manifest.tournamentManifestHash !== tournament.manifestHash)
    throw new Error(
      'Selection manifest tournament hash does not match canonical tournament manifest',
    )
  const tournamentCandidate = tournament.candidates.find(
    (candidate) => candidate.candidateId === manifest.candidateId,
  )
  if (!tournamentCandidate || tournamentCandidate.finalStatus !== 'reviewed')
    throw new Error(
      'Selection manifest candidate is not reviewed in canonical tournament manifest',
    )
}

export function selectedCandidate(manifest: SelectionManifest) {
  assertSelectionManifest(manifest)
  return candidateById(manifest.candidateId)!
}

export function assertApprovedModel(
  approved: SelectionManifest,
  role: 'writer' | 'annotator',
  requested: string,
  returned?: string,
) {
  const candidate = selectedCandidate(approved)
  const expected = role === 'writer' ? candidate.writer : candidate.annotator
  if (requested !== expected)
    throw new Error(
      `Requested ${role} model is not approved by selection manifest`,
    )
  if (returned !== undefined && returned !== expected)
    throw new Error(
      `Provider returned ${role} model does not match approved selection manifest`,
    )
}

export function partitionManifest(
  stage: CorpusStage,
  documents: PartitionManifest['documents'],
  nearDuplicateSignatures: NearDuplicateSignature[],
): PartitionManifest {
  const unsigned = { stage, documents, nearDuplicateSignatures }
  const manifest = { ...unsigned, manifestHash: canonicalHash(unsigned) }
  assertPartitionManifest(manifest, stage)
  return manifest
}

export function assertPartitionManifest(
  value: unknown,
  expectedStage?: CorpusStage,
): asserts value is PartitionManifest {
  if (!value || typeof value !== 'object')
    throw new Error('External partition manifest is malformed')
  const manifest = value as Partial<PartitionManifest>
  if (
    !isStage(manifest.stage) ||
    !Array.isArray(manifest.documents) ||
    !Array.isArray(manifest.nearDuplicateSignatures) ||
    !isHash(manifest.manifestHash) ||
    manifest.documents.length === 0
  )
    throw new Error(
      'External partition manifest is missing required non-empty evidence',
    )
  if (expectedStage && manifest.stage !== expectedStage)
    throw new Error(
      `External partition manifest stage mismatch: expected ${expectedStage}`,
    )
  const { manifestHash, ...unsigned } = manifest
  if (canonicalHash(unsigned) !== manifestHash)
    throw new Error('External partition manifest hash is stale or tampered')
  const documentIds = new Set<string>()
  for (const document of manifest.documents)
    if (
      !document ||
      !nonBlank(document.id) ||
      documentIds.has(document.id) ||
      !isHash(document.textHash) ||
      !isHash(document.recordHash)
    )
      throw new Error(
        'External partition manifest contains invalid document hashes',
      )
    else documentIds.add(document.id)
  const signatureIds = new Set<string>()
  for (const signature of manifest.nearDuplicateSignatures)
    if (
      !signature ||
      !documentIds.has(signature.id) ||
      signatureIds.has(signature.id) ||
      !isHash(signature.textHash) ||
      signature.textHash !==
        manifest.documents.find((document) => document.id === signature.id)
          ?.textHash ||
      !Array.isArray(signature.shingles) ||
      signature.shingles.length === 0 ||
      !signature.shingles.every(
        (shingle) => typeof shingle === 'string' && shingle.trim().length > 0,
      )
    )
      throw new Error(
        'External partition manifest contains invalid duplicate signatures',
      )
    else signatureIds.add(signature.id)
  if (signatureIds.size !== documentIds.size)
    throw new Error(
      'External partition manifest is missing duplicate signatures',
    )
  const expectedIds = new Set(
    corpusStageSpecs(manifest.stage).map((spec) => spec.id),
  )
  if (
    expectedIds.size !== documentIds.size ||
    [...expectedIds].some((id) => !documentIds.has(id))
  )
    throw new Error(
      'External partition manifest does not contain the expected finalized specifications',
    )
}

export function assertExternalPartitionRegistry(
  value: unknown,
  candidateStage: CorpusStage,
): asserts value is ExternalPartitionRegistry {
  if (!value || typeof value !== 'object')
    throw new Error('External partition registry is malformed')
  const registry = value as Partial<ExternalPartitionRegistry>
  if (
    registry.version !== partitionRegistryVersion ||
    !Array.isArray(registry.partitions)
  )
    throw new Error('External partition registry has invalid versioned fields')
  if (registry.partitions.length === 0) {
    if (
      registry.noPriorPartitions !== true ||
      candidateStage !== 'training_seed'
    )
      throw new Error(
        'Only the first training_seed partition may use an empty no-prior-partitions registry',
      )
    return
  }
  if (registry.noPriorPartitions !== undefined)
    throw new Error(
      'External partition registry cannot attest no prior partitions when partitions exist',
    )
  const requiredStages = requiredPriorStages(candidateStage)
  const stages = new Set<CorpusStage>()
  const documentIds = new Set<string>()
  for (const partition of registry.partitions) {
    if (
      !partition ||
      !isStage(partition.stage) ||
      partition.stage === candidateStage ||
      stages.has(partition.stage) ||
      !isHash(partition.manifestHash)
    )
      throw new Error('External partition registry has invalid stage entries')
    assertPartitionManifest(partition.manifest, partition.stage)
    if (partition.manifest.manifestHash !== partition.manifestHash)
      throw new Error(
        'External partition registry manifest hash is stale or tampered',
      )
    for (const document of partition.manifest.documents) {
      if (documentIds.has(document.id))
        throw new Error(
          'External partition registry has duplicate document IDs',
        )
      documentIds.add(document.id)
    }
    stages.add(partition.stage)
  }
  if (
    stages.size !== requiredStages.length ||
    requiredStages.some((stage) => !stages.has(stage))
  )
    throw new Error(
      'External partition registry is missing required prior stages',
    )
  assertDisjointDatasetManifests(
    registry.partitions.map((partition) => ({
      stage: partition.stage,
      documentHashes: partition.manifest.documents.map(
        (document) => document.textHash,
      ),
    })),
  )
}

export function partitionRegistry(
  candidateStage: CorpusStage,
  manifests: PartitionManifest[],
): ExternalPartitionRegistry {
  if (manifests.length === 0) {
    const registry = {
      version: partitionRegistryVersion,
      noPriorPartitions: true as const,
      partitions: [],
    }
    assertExternalPartitionRegistry(registry, candidateStage)
    return registry
  }
  const partitions = manifests.map((manifest) => ({
    stage: manifest.stage,
    manifestHash: manifest.manifestHash,
    manifest,
  }))
  const registry = { version: partitionRegistryVersion, partitions }
  assertExternalPartitionRegistry(registry, candidateStage)
  return registry
}

export function assertDisjointDatasetManifests(
  manifests: Array<{ stage: string; documentHashes: string[] }>,
) {
  const seen = new Set<string>()
  for (const manifest of manifests)
    for (const hash of manifest.documentHashes) {
      if (seen.has(hash))
        throw new Error(
          `Cross-partition document hash overlap in ${manifest.stage}`,
        )
      seen.add(hash)
    }
}

export function datasetManifest(
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  const hashes = documents.map((document) => document.contentHash).sort()
  return {
    ...metadata,
    documentHashes: hashes,
    manifestHash: canonicalHash({ metadata, hashes }),
  }
}

export const benchmarkAuditPlan = {
  requiredIndependentJudgeAgreement: true,
  strata: ['person_protected', 'hard_negative', 'person_professional'],
  minimumHumanAuditFraction: 0.15,
  disputeHandling: 'second independent judge then human adjudication',
} as const

function isBlindReviewPackage(value: unknown): value is BlindReviewPackage {
  try {
    assertBlindReviewPackage(value)
    return true
  } catch {
    return false
  }
}

export function assertBlindReviewPackage(
  value: unknown,
): asserts value is BlindReviewPackage {
  if (!value || typeof value !== 'object')
    throw new Error('Blind review package is invalid')
  const review = value as Partial<BlindReviewPackage>
  if (
    review.version !== 'synthetic-v2-blind-review:v1' ||
    !isBlindId(review.blindId) ||
    !Array.isArray(review.documents) ||
    review.documents.length === 0 ||
    review.documents.some((document) =>
      Boolean(
        document && typeof document === 'object' && 'generator' in document,
      ),
    ) ||
    !review.scorecard ||
    canonicalJson(review.scorecard) !==
      canonicalJson({
        criteria: ['annotation_accuracy', 'hard_negative_handling', 'realism'],
      })
  )
    throw new Error('Blind review package is invalid')
  const serialized = canonicalJson(review)
  for (const candidate of reviewedCandidates)
    if (
      serialized.includes(candidate.id) ||
      serialized.includes(candidate.writer)
    )
      throw new Error('Blind review package leaks candidate identity')
}

function isCompletedScorecard(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const scorecard = value as Record<string, unknown>
  return (
    typeof scorecard.annotation_accuracy === 'number' &&
    typeof scorecard.hard_negative_handling === 'number' &&
    typeof scorecard.realism === 'number' &&
    Object.values(scorecard).every(
      (score) => typeof score === 'number' && Number.isFinite(score),
    )
  )
}

function isTournamentFinalization(
  value: unknown,
): value is TournamentFinalization {
  if (!value || typeof value !== 'object') return false
  const finalization = value as Partial<TournamentFinalization>
  return (
    isHash(finalization.tournamentManifestHash) &&
    Array.isArray(finalization.reviews) &&
    typeof finalization.selectedCandidateId === 'string' &&
    isDate(finalization.approvedAt) &&
    nonBlank(finalization.approvedBy) &&
    nonBlank(finalization.termsReviewReference)
  )
}

function candidateById(id: string) {
  return reviewedCandidates.find((candidate) => candidate.id === id)
}

function isBlindId(value: unknown): value is string {
  return typeof value === 'string' && /^review-[1-9][0-9]*$/.test(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function requiredPriorStages(stage: CorpusStage): CorpusStage[] {
  switch (stage) {
    case 'training_seed':
      return []
    case 'development_challenge':
      return ['training_seed']
    case 'benchmark':
      return ['training_seed', 'development_challenge']
    case 'tournament':
      return []
  }
}

function isStage(value: unknown): value is CorpusStage {
  return (
    typeof value === 'string' &&
    [
      'tournament',
      'training_seed',
      'development_challenge',
      'benchmark',
    ].includes(value)
  )
}

function isDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonBlank)
}
