import { benchmarkAuditPlan, canonicalHash } from './governance'
import { qaSample, requiresRegeneration, type JudgeVerdict } from './qa'
import type { SyntheticDocument } from './types'

export type AuditRecord = {
  id: string
  completed: boolean
  reviewer: string
  evidenceHash?: string
}

export type PromotionApproval = {
  approvedBy: string
  approvedAt: string
  termsReviewReference: string
}

export type HumanDisposition = {
  id: string
  decision: 'approved' | 'rejected'
  reviewer: string
  adjudicatedAt: string
  evidenceHash: string
}

export type PromotionEvidence = {
  /** Required by the promotion command, which binds evidence to the validated candidate. */
  candidateManifestHash?: string
  /** Canonical hash of the complete validated prior-partition registry. */
  partitionRegistryHash?: string
  judgeVerdicts: JudgeVerdict[]
  disputeVerdicts: JudgeVerdict[]
  /** Required for every failed verdict or independent-judge disagreement. */
  humanDispositions?: HumanDisposition[]
  audits: AuditRecord[]
  approval?: PromotionApproval
}

/** Fail-closed release gate for a benchmark candidate set. */
export function assertBenchmarkPromotion(
  documents: SyntheticDocument[],
  evidence: PromotionEvidence,
  minimumAuditFraction = benchmarkAuditPlan.minimumHumanAuditFraction,
) {
  if (documents.length === 0)
    throw new Error('Benchmark promotion requires a non-empty candidate set')
  if (
    evidence.candidateManifestHash !== undefined &&
    !isHash(evidence.candidateManifestHash)
  )
    throw new Error(
      'Benchmark promotion evidence has an invalid candidate manifest hash',
    )
  if (
    evidence.partitionRegistryHash !== undefined &&
    !isHash(evidence.partitionRegistryHash)
  )
    throw new Error(
      'Benchmark promotion evidence has an invalid partition registry hash',
    )
  const documentIds = new Set(documents.map((document) => document.id))
  if (documentIds.size !== documents.length)
    throw new Error('Benchmark promotion candidate has duplicate document IDs')
  const primary = verdictsById(
    evidence.judgeVerdicts,
    documentIds,
    'independent QA',
  )
  const disputes = verdictsById(
    evidence.disputeVerdicts,
    documentIds,
    'dispute QA',
  )
  const dispositions = dispositionsById(
    evidence.humanDispositions ?? [],
    documentIds,
  )
  for (const document of documents) {
    const verdict = primary.get(document.id)
    if (!verdict)
      throw new Error(`Missing independent QA verdict for ${document.id}`)
    const needsDispute =
      requiresRegeneration(verdict) ||
      document.spans.some((span) => span.category === 'person_protected') ||
      (document.hardNegatives?.length ?? 0) > 0
    if (needsDispute) {
      const second = disputes.get(document.id)
      if (!second) throw new Error(`Unresolved QA dispute for ${document.id}`)
      if (
        requiresRegeneration(verdict) ||
        requiresRegeneration(second) ||
        !sameIndependentVerdict(verdict, second)
      ) {
        const disposition = dispositions.get(document.id)
        if (!disposition || disposition.decision !== 'approved')
          throw new Error(
            `Benchmark promotion requires a hashed human disposition for ${document.id}`,
          )
      }
    }
  }
  const required = qaSample(documents, minimumAuditFraction)
  const audits = auditsById(evidence.audits, documentIds)
  for (const document of required) {
    const audit = audits.get(document.id)
    if (
      !audit ||
      !audit.completed ||
      !audit.reviewer.trim() ||
      !isHash(audit.evidenceHash)
    )
      throw new Error(
        `Benchmark promotion requires completed audit evidence for ${document.id}`,
      )
  }
  if (
    !evidence.approval ||
    !evidence.approval.approvedBy.trim() ||
    !evidence.approval.termsReviewReference.trim() ||
    !isDate(evidence.approval.approvedAt)
  )
    throw new Error(
      'Benchmark promotion requires a dated approver and terms-review reference',
    )
}

export function assertCandidateEvidenceBinding(
  candidateManifestHash: string,
  evidence: PromotionEvidence,
) {
  if (
    !isHash(candidateManifestHash) ||
    evidence.candidateManifestHash !== candidateManifestHash
  )
    throw new Error(
      'Benchmark promotion evidence does not bind the validated candidate manifest',
    )
}

/** Public release metadata deliberately excludes private paths, reviewers, and QA evidence. */
export function publicPromotionMetadata(
  candidateManifestHash: string,
  evidence: PromotionEvidence,
) {
  assertCandidateEvidenceBinding(candidateManifestHash, evidence)
  if (!evidence.approval)
    throw new Error('Benchmark promotion requires approval before publication')
  if (!isHash(evidence.partitionRegistryHash))
    throw new Error('Benchmark promotion requires bound partition registry evidence')
  return {
    stage: 'benchmark',
    version: 'synthetic-v2-benchmark-promotion:v2',
    candidateManifestHash,
    partitionRegistryHash: evidence.partitionRegistryHash,
    promotionEvidenceHash: promotionEvidenceHash(evidence),
    approvedAt: evidence.approval.approvedAt,
    termsReviewReference: evidence.approval.termsReviewReference,
  }
}

export function promotionEvidenceHash(evidence: PromotionEvidence) {
  return canonicalHash(evidence)
}

function verdictsById(
  verdicts: JudgeVerdict[],
  documentIds: Set<string>,
  label: string,
) {
  const result = new Map<string, JudgeVerdict>()
  for (const verdict of verdicts) {
    if (
      !isJudgeVerdict(verdict) ||
      !documentIds.has(verdict.id) ||
      result.has(verdict.id)
    )
      throw new Error(`Benchmark promotion has invalid ${label} verdict IDs`)
    result.set(verdict.id, verdict)
  }
  return result
}

function dispositionsById(
  dispositions: HumanDisposition[],
  documentIds: Set<string>,
) {
  const result = new Map<string, HumanDisposition>()
  for (const disposition of dispositions) {
    if (
      !documentIds.has(disposition.id) ||
      result.has(disposition.id) ||
      (disposition.decision !== 'approved' &&
        disposition.decision !== 'rejected') ||
      !disposition.reviewer.trim() ||
      !isDate(disposition.adjudicatedAt) ||
      !isHash(disposition.evidenceHash)
    )
      throw new Error('Benchmark promotion has invalid human dispositions')
    result.set(disposition.id, disposition)
  }
  return result
}

function sameIndependentVerdict(left: JudgeVerdict, right: JudgeVerdict) {
  return (
    canonicalHash({
      allProposedSpansCorrect: left.allProposedSpansCorrect,
      hardNegativesCorrect: left.hardNegativesCorrect,
      hardNegativeAssertions: left.hardNegativeAssertions,
      referenceSpans: left.referenceSpans,
      obviousUnmarkedSpans: left.obviousUnmarkedSpans,
      realismScore: left.realismScore,
    }) ===
    canonicalHash({
      allProposedSpansCorrect: right.allProposedSpansCorrect,
      hardNegativesCorrect: right.hardNegativesCorrect,
      hardNegativeAssertions: right.hardNegativeAssertions,
      referenceSpans: right.referenceSpans,
      obviousUnmarkedSpans: right.obviousUnmarkedSpans,
      realismScore: right.realismScore,
    })
  )
}

function auditsById(audits: AuditRecord[], documentIds: Set<string>) {
  const result = new Map<string, AuditRecord>()
  for (const audit of audits) {
    if (!documentIds.has(audit.id) || result.has(audit.id))
      throw new Error('Benchmark promotion has invalid audit IDs')
    result.set(audit.id, audit)
  }
  return result
}

function isJudgeVerdict(value: unknown): value is JudgeVerdict {
  if (!value || typeof value !== 'object') return false
  const verdict = value as Partial<JudgeVerdict>
  return (
    typeof verdict.id === 'string' &&
    typeof verdict.allProposedSpansCorrect === 'boolean' &&
    typeof verdict.hardNegativesCorrect === 'boolean' &&
    Array.isArray(verdict.hardNegativeAssertions) &&
    verdict.hardNegativeAssertions.every(
      (assertion) =>
        assertion &&
        typeof assertion.assertionId === 'string' &&
        typeof assertion.correctlyUnlabelled === 'boolean',
    ) &&
    Array.isArray(verdict.referenceSpans) &&
    Array.isArray(verdict.obviousUnmarkedSpans) &&
    typeof verdict.realismScore === 'number' &&
    typeof verdict.confidence === 'number' &&
    typeof verdict.rationale === 'string'
  )
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
