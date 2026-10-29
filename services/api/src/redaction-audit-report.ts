import type {
  RedactionRunRecord,
  RedactionAuditLogEntry,
} from './redaction-database'

export const AUDIT_REPORT_VERSION = 'obiter.redaction-audit/v2'

export function buildAuditReport(
  run: RedactionRunRecord,
  auditLog: RedactionAuditLogEntry[],
) {
  const finalized = [...auditLog]
    .reverse()
    .find((entry) => entry.action === 'redaction.finalize')
  return {
    reportVersion: AUDIT_REPORT_VERSION,
    redactionRunId: run.id,
    generatedAt: new Date().toISOString(),
    originalDocument: {
      documentId: run.documentId,
      versionId: run.documentVersionId,
      filename: run.sourceFilename,
    },
    redactionRunSummary: {
      totalSpans: run.summary.totalSpans,
      byCategory: run.summary.byCategory,
      bySource: run.summary.bySource,
      decisionsBreakdown: run.summary.byDecision,
    },
    detectorVersion: run.detectorVersion,
    detectionMode: run.detectionMode,
    policyMode: run.policyMode,
    output: run.outputId
      ? {
          outputId: run.outputId,
          outputType: 'redaction_output' as const,
          outputMode: run.summary.outputMode ?? null,
        }
      : null,
    auditLog,
    spanDecisions: Object.entries(run.decisions).flatMap(
      ([spanId, decision]) => {
        const span = run.spans.find((item) => item.id === spanId)
        return span
          ? [
              {
                spanId,
                spanText: span.text,
                category: span.category,
                decision: decision.decision,
                decidedBy: decision.decidedBy,
                decidedAt: decision.decidedAt,
              },
            ]
          : []
      },
    ),
    reviewerInfo: finalized
      ? { userId: finalized.userId, reviewedAt: finalized.timestamp }
      : null,
  }
}
