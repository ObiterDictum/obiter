import { documentTextLayoutSchema } from '@obiter/contracts'
import type { Pool } from 'pg'
import type { buildAuditReport } from './redaction-audit-report'
import {
  getRunLayoutObjectKey,
  type RedactionRunRecord,
} from './redaction-database'
import { reviewerNames } from './reviewer-names'
import type { StorageService } from './storage'
import type { AuthenticatedOrgUser } from './authz'

type AuditReport = ReturnType<typeof buildAuditReport>

export const SHAREABLE_AUDIT_VERSION = 'obiter.redaction-audit-shareable/v1'

/**
 * The audit as a file that can be handed to the other side. It carries what the
 * schedule carries — counts, categories, decisions, reviewers, times, where each
 * span sat, and the output's SHA-256 — and never the removed words, the source
 * filename or any source text. The restricted JSON keeps those for the run's own
 * access-controlled record; this format is the one that leaves the firm.
 */
export function buildShareableAuditReport(
  report: AuditReport,
  run: RedactionRunRecord,
  names: Map<string, string>,
  pageBySpanId: Map<string, number>,
) {
  const decisions = report.spanDecisions
  const kept = decisions.filter(
    (entry) => entry.decision === 'reject' || entry.decision === 'override_keep',
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

/**
 * The page each span sits on, from the layout the review screen reads. A source
 * without a stored layout (or one this API cannot parse) leaves every page
 * absent rather than guessing: a wrong page number in an audit file is worse
 * than none.
 */
async function pagesBySpan(
  pool: Pool,
  storage: StorageService,
  run: RedactionRunRecord,
  user: AuthenticatedOrgUser,
) {
  const pages = new Map<string, number>()
  const layoutObjectKey = await getRunLayoutObjectKey(pool, run, user)
  if (!layoutObjectKey || !storage.readText) return pages
  let stored: unknown
  try {
    stored = JSON.parse(await storage.readText(layoutObjectKey))
  } catch {
    return pages
  }
  const layout = documentTextLayoutSchema.safeParse(stored)
  if (!layout.success) return pages
  for (const span of run.spans) {
    const segment = layout.data.segments.find(
      (candidate) =>
        candidate.start <= span.start && candidate.end > span.start,
    )
    if (segment) pages.set(span.id, segment.pageIndex + 1)
  }
  return pages
}

/** The shareable audit as the bytes the download serves. */
export async function shareableAuditBytes(
  pool: Pool,
  storage: StorageService,
  run: RedactionRunRecord,
  user: AuthenticatedOrgUser,
  report: AuditReport,
): Promise<Uint8Array> {
  const names = await reviewerNames(
    pool,
    run.organisationId,
    [
      ...Object.values(run.decisions).map((decision) => decision.decidedBy),
      ...report.auditLog.flatMap((entry) => entry.userId ?? []),
    ],
  )
  const shareable = buildShareableAuditReport(
    report,
    run,
    names,
    await pagesBySpan(pool, storage, run, user),
  )
  return new TextEncoder().encode(`${JSON.stringify(shareable, null, 2)}\n`)
}

export function shareableAuditFilename() {
  return 'redaction-audit.json'
}
