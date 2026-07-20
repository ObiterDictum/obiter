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
export type PromotionEvidence = {
  judgeVerdicts: JudgeVerdict[]
  disputeVerdicts: JudgeVerdict[]
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
  const primary = new Map(
    evidence.judgeVerdicts.map((verdict) => [verdict.id, verdict]),
  )
  const disputes = new Map(
    evidence.disputeVerdicts.map((verdict) => [verdict.id, verdict]),
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
      if (!second || requiresRegeneration(second))
        throw new Error(`Unresolved QA dispute for ${document.id}`)
    }
    if (requiresRegeneration(verdict) && !disputes.has(document.id))
      throw new Error(`Rejected primary QA verdict for ${document.id}`)
  }
  const required = qaSample(documents, minimumAuditFraction)
  const audits = new Map(
    evidence.audits
      .filter((audit) => audit.completed)
      .map((audit) => [audit.id, audit]),
  )
  for (const document of required) {
    const audit = audits.get(document.id)
    if (
      !audit ||
      !audit.reviewer.trim() ||
      !audit.evidenceHash ||
      !/^[a-f0-9]{64}$/.test(audit.evidenceHash)
    )
      throw new Error(
        `Benchmark promotion requires completed audit evidence for ${document.id}`,
      )
  }
  if (
    !evidence.approval ||
    !evidence.approval.approvedBy.trim() ||
    !evidence.approval.termsReviewReference.trim() ||
    !Number.isFinite(Date.parse(evidence.approval.approvedAt))
  )
    throw new Error(
      'Benchmark promotion requires a dated approver and terms-review reference',
    )
}

export function promotionEvidenceHash(evidence: PromotionEvidence) {
  return canonicalHash(evidence)
}
