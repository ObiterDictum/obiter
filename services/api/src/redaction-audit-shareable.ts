import {
  documentTextLayoutSchema,
  type DocumentTextLayout,
} from '@obiter/contracts'
import type { Pool } from 'pg'
import type { buildAuditReport } from './redaction-audit-report'
import {
  getRunLayoutObjectKey,
  type RedactionRunRecord,
} from './redaction-database'
import type { StorageService } from './storage'
import type { AuthenticatedOrgUser } from './authz'

type AuditReport = ReturnType<typeof buildAuditReport>

export const SHAREABLE_AUDIT_VERSION = 'obiter.redaction-audit-shareable/v1'

export type ShareableAuditReport = ReturnType<typeof buildShareableAuditReport>

export function buildShareableAuditReport(
  report: AuditReport,
  run: RedactionRunRecord,
  names: Map<string, string>,
  pageBySpanId: Map<string, number>,
) {
  const decisions = report.spanDecisions
  const kept = decisions.filter(
    (entry) =>
      entry.decision === 'reject' || entry.decision === 'override_keep',
  ).length
  return {
    reportVersion: SHAREABLE_AUDIT_VERSION,
    redactionRunId: report.redactionRunId,
    generatedAt: report.generatedAt,
    detectionMode: report.detectionMode,
    policyMode: report.policyMode,
    detectorVersion: report.detectorVersion,
    summary: {
      totalSpans: report.redactionRunSummary.totalSpans,
      byCategory: report.redactionRunSummary.byCategory,
      byDecision: report.redactionRunSummary.decisionsBreakdown,
      removedCount: decisions.length - kept,
      keptCount: kept,
    },
    output: report.output
      ? {
          outputMode: report.output.outputMode,
          outputSha256: run.summary.outputSha256 ?? null,
          securePdf: run.summary.securePdf === true,
        }
      : null,
    reviewedBy: report.reviewerInfo
      ? {
          name: report.reviewerInfo.userId
            ? (names.get(report.reviewerInfo.userId) ?? null)
            : null,
          reviewedAt: report.reviewerInfo.reviewedAt,
        }
      : null,
    decisions: decisions.map((entry) => ({
      category: entry.category,
      decision: entry.decision,
      decidedBy: names.get(entry.decidedBy) ?? null,
      decidedAt: entry.decidedAt,
      page: pageBySpanId.get(entry.spanId) ?? null,
    })),
    auditLog: report.auditLog.map((entry) => ({
      timestamp: entry.timestamp,
      action: entry.action,
      actor: entry.userId ? (names.get(entry.userId) ?? null) : null,
    })),
  }
}

export function shareableAuditBytes(report: ShareableAuditReport) {
  return new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`)
}

export function spanPages(
  layout: DocumentTextLayout,
  spans: RedactionRunRecord['spans'],
) {
  const pages = new Map<string, number>()
  for (const span of spans) {
    const segment = layout.segments.find(
      (candidate) =>
        candidate.start <= span.start && candidate.end > span.start,
    )
    if (segment) pages.set(span.id, segment.pageIndex + 1)
  }
  return pages
}

export async function shareableSpanPages(
  pool: Pool,
  storage: StorageService,
  run: RedactionRunRecord,
  user: AuthenticatedOrgUser,
) {
  const layoutObjectKey = await getRunLayoutObjectKey(pool, run, user)
  if (!layoutObjectKey || !storage.readText) return new Map<string, number>()
  let stored: unknown
  try {
    stored = JSON.parse(await storage.readText(layoutObjectKey))
  } catch {
    return new Map<string, number>()
  }
  const layout = documentTextLayoutSchema.safeParse(stored)
  if (!layout.success) return new Map<string, number>()
  return spanPages(layout.data, run.spans)
}

export function shareableAuditFilename() {
  return 'redaction-audit.json'
}
