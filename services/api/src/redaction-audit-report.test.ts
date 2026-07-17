import { describe, expect, it } from 'vitest'
import {
  AUDIT_REPORT_VERSION,
  buildAuditReport,
  renderAuditHtml,
  renderAuditMarkdown,
} from './redaction-audit-report'
import type { RedactionRunRecord } from './redaction-database'

const run: RedactionRunRecord = {
  id: 'red_1',
  organisationId: 'org_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'skeleton.docx',
  sourceTextObjectKey: 'org/org_1/redaction-runs/red_1/source',
  status: 'finalized',
  policyMode: 'internal_ai_minimisation',
  spans: [],
  decisions: {},
  outputArtifactId: 'art_1',
  detectorVersion: 'rampart-0.1.3',
  createdBy: 'usr_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
  summary: {
    totalSpans: 1,
    byCategory: {} as never,
    bySource: { rampartModel: 1, rampartDeterministic: 0, ukSupplement: 0 },
    byDecision: {
      accept: 1,
      reject: 0,
      override_redact: 0,
      override_keep: 0,
      pseudonymise: 0,
      undecided: 0,
    },
    reviewedCount: 1,
    unreviewedCount: 0,
    outputMode: 'redacted',
  },
}

describe('buildAuditReport', () => {
  it('has a stable versioned shape and retains full decision history', () => {
    const report = buildAuditReport(run, [
      {
        action: 'redaction.run_create',
        userId: 'usr_1',
        timestamp: '2026-01-01T00:00:00.000Z',
        details: {},
      },
      {
        action: 'redaction.span_decision',
        userId: 'usr_1',
        timestamp: '2026-01-01T00:01:00.000Z',
        details: { spanId: 'span_1', decision: 'accept' },
      },
      {
        action: 'redaction.finalize',
        userId: 'usr_1',
        timestamp: '2026-01-01T00:02:00.000Z',
        details: { artifactId: 'art_1' },
      },
    ])
    expect(report.reportVersion).toBe(AUDIT_REPORT_VERSION)
    expect(report.auditLog).toHaveLength(3)
    expect(report.reviewerInfo).toEqual({
      userId: 'usr_1',
      reviewedAt: '2026-01-01T00:02:00.000Z',
    })
    expect(renderAuditMarkdown(report)).toContain('redaction.span_decision')
    expect(renderAuditHtml(report)).toContain('<!doctype html>')
  })
})
