import type {
  RedactionRunRecord,
  RedactionAuditLogEntry,
} from './redaction-database'

export const AUDIT_REPORT_VERSION = 'obiter.redaction-audit/v1'

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
    policyMode: run.policyMode,
    outputArtifact: run.outputArtifactId
      ? {
          artifactId: run.outputArtifactId,
          artifactType: 'redaction_output' as const,
          outputMode: run.summary.outputMode ?? null,
        }
      : null,
    auditLog,
    spanDecisions: Object.entries(run.decisions).flatMap(([spanId, decision]) => {
      const span = run.spans.find((item) => item.id === spanId)
      return span ? [{
        spanId, spanText: span.text, category: span.category, decision: decision.decision,
        decidedBy: decision.decidedBy, decidedAt: decision.decidedAt,
      }] : []
    }),
    reviewerInfo: finalized
      ? { userId: finalized.userId, reviewedAt: finalized.timestamp }
      : null,
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function renderAuditMarkdown(
  report: ReturnType<typeof buildAuditReport>,
) {
  return `# Obiter Redaction Audit Report\n\n- **Report version:** ${report.reportVersion}\n- **Run:** ${report.redactionRunId}\n- **Generated:** ${report.generatedAt}\n- **Source:** ${report.originalDocument.filename}\n- **Detector:** ${report.detectorVersion ?? 'not recorded'}\n- **Policy:** ${report.policyMode}\n\n## Summary\n\n${JSON.stringify(report.redactionRunSummary, null, 2)}\n\n## Audit log\n\n${report.auditLog.map((entry) => `- ${entry.timestamp} — ${entry.action} — ${entry.userId ?? 'system'} — ${JSON.stringify(entry.details)}`).join('\n')}\n`
}

export function renderAuditHtml(report: ReturnType<typeof buildAuditReport>) {
  const markdown = renderAuditMarkdown(report)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Obiter Redaction Audit Report</title></head><body><pre>${escapeHtml(markdown)}</pre></body></html>`
}
