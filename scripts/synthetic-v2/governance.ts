import { createHash } from 'node:crypto'
import type { CorpusStage } from './program'
import type { NearDuplicateSignature } from './validation'
import type { SyntheticDocument } from './types'

export const selectionManifestVersion = 'synthetic-v2-selection:v1'
export const tournamentManifestVersion = 'synthetic-v2-tournament:v1'

export type Candidate = {
  id: string
  writer: string
  annotator: string
  reviewed: boolean
}

export const reviewedCandidates: Candidate[] = [
  {
    id: 'deepseek-pro-haiku',
    writer: 'deepseek-v4-pro',
    annotator: 'anthropic/claude-haiku-4.5',
    reviewed: true,
  },
  {
    id: 'deepseek-flash-haiku',
    writer: 'deepseek-v4-flash',
    annotator: 'anthropic/claude-haiku-4.5',
    reviewed: true,
  },
  {
    id: 'opus-haiku',
    writer: 'anthropic/claude-opus-4.8',
    annotator: 'anthropic/claude-haiku-4.5',
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

export type TournamentManifest = {
  version: typeof tournamentManifestVersion
  candidates: Array<{
    candidateId: string
    specificationIds: string[]
    seeds: string[]
    canonicalArtifactHash: string
    blindReviewScorecardHash: string
    finalStatus: 'pending_review' | 'reviewed' | 'rejected'
  }>
  manifestHash: string
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
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
    typeof manifest.tournamentManifestHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.tournamentManifestHash) ||
    typeof manifest.approvedAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.approvedAt))
  )
    throw new Error('Selection manifest has invalid versioned approval fields')
  const candidate = reviewedCandidates.find(
    (entry) => entry.id === manifest.candidateId,
  )
  if (!candidate || !candidate.reviewed)
    throw new Error('Selection manifest names an unknown reviewed candidate')
  if (
    candidate.writer !== manifest.writerId ||
    candidate.annotator !== manifest.annotatorId
  )
    throw new Error('Selection manifest model IDs do not match its candidate')
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
    typeof manifest.manifestHash !== 'string'
  )
    throw new Error('Tournament manifest has invalid versioned fields')
  const { manifestHash, ...unsigned } = manifest
  if (canonicalHash(unsigned) !== manifestHash)
    throw new Error('Tournament manifest hash is stale or tampered')
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
  return reviewedCandidates.find(
    (candidate) => candidate.id === manifest.candidateId,
  )!
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

export type PartitionManifest = {
  stage: CorpusStage
  documents: Array<{ id: string; textHash: string; recordHash: string }>
  nearDuplicateSignatures: NearDuplicateSignature[]
}

export function assertPartitionManifest(
  value: unknown,
  expectedStage?: CorpusStage,
): asserts value is PartitionManifest {
  if (!value || typeof value !== 'object')
    throw new Error('External partition manifest is malformed')
  const manifest = value as Partial<PartitionManifest>
  if (
    !manifest.stage ||
    !Array.isArray(manifest.documents) ||
    !Array.isArray(manifest.nearDuplicateSignatures) ||
    manifest.documents.length === 0
  )
    throw new Error(
      'External partition manifest is missing required non-empty evidence',
    )
  if (expectedStage && manifest.stage !== expectedStage)
    throw new Error(
      `External partition manifest stage mismatch: expected ${expectedStage}`,
    )
  for (const document of manifest.documents)
    if (
      !document ||
      typeof document.id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(document.textHash) ||
      !/^[a-f0-9]{64}$/.test(document.recordHash)
    )
      throw new Error(
        'External partition manifest contains invalid document hashes',
      )
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
