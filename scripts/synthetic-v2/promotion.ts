import type { JudgeVerdict } from './qa'
import type { SyntheticDocument } from './types'

export type AuditRecord = {
  id: string
  completed: boolean
  reviewer: string
}

export type PromotionEvidence = {
  judgeVerdicts: JudgeVerdict[]
  disputeVerdicts: JudgeVerdict[]
  audits: AuditRecord[]
}

/** Fail-closed release gate for a benchmark candidate set. */
export function assertBenchmarkPromotion(
  documents: SyntheticDocument[],
  evidence: PromotionEvidence,
  minimumAuditFraction = 0.15,
) {
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
    const accepted =
      verdict.allProposedSpansCorrect &&
      verdict.hardNegativesCorrect &&
      verdict.obviousUnmarkedSpans.length === 0 &&
      verdict.realismScore >= 4 &&
      verdict.confidence >= 0.8
    if (!accepted) {
      const dispute = disputes.get(document.id)
      if (
        !dispute ||
        !dispute.allProposedSpansCorrect ||
        !dispute.hardNegativesCorrect
      )
        throw new Error(`Unresolved QA dispute for ${document.id}`)
    }
  }
  const requiredAudits = Math.ceil(documents.length * minimumAuditFraction)
  const complete = evidence.audits.filter((audit) => audit.completed)
  if (complete.length < requiredAudits)
    throw new Error(
      `Benchmark promotion requires ${requiredAudits} completed audits`,
    )
}
