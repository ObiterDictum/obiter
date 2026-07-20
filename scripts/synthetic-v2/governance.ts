import { createHash } from 'node:crypto'
import type { CorpusStage } from './program'
import type { SyntheticDocument } from './types'

export type Candidate = {
  id: string
  writer: string
  annotator: string
  reviewed: boolean
}
export type SelectionManifest = {
  candidateId: string
  tournamentManifestHash: string
  approvedAt: string
  approvedBy: string
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

export function requireSelection(
  stage: CorpusStage,
  manifest: SelectionManifest | undefined,
) {
  if (stage === 'tournament') return
  if (
    !manifest ||
    !reviewedCandidates.some(
      (candidate) =>
        candidate.id === manifest.candidateId && candidate.reviewed,
    )
  )
    throw new Error(
      `Stage ${stage} requires an approved reviewed candidate selection manifest`,
    )
}

export function datasetManifest(
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  const hashes = documents.map((document) => document.contentHash).sort()
  return {
    ...metadata,
    documentHashes: hashes,
    manifestHash: createHash('sha256')
      .update(JSON.stringify(hashes))
      .digest('hex'),
  }
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

export const benchmarkAuditPlan = {
  requiredIndependentJudgeAgreement: true,
  strata: ['person_protected', 'hard_negative', 'person_professional'],
  minimumHumanAuditFraction: 0.15,
  disputeHandling: 'second independent judge then human adjudication',
} as const
