import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'
import {
  AUDIT_REPORT_VERSION,
  buildAuditReport,
} from './redaction-audit-report'
import {
  scheduleLines,
  renderSchedulePdf,
  renderScheduleDocx,
  scheduleExportFilename,
} from './redaction-schedule-export'
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
  sourceFileObjectKey: null,
  sourceLayoutObjectKey: null,
  sourceMimeType: null,
  status: 'finalized',
  policyMode: 'internal_ai_minimisation',
  spans: [],
  decisions: {},
  outputId: 'out_1',
  detectorVersion: 'rampart-0.1.3',
  detectionMode: 'heuristics+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  returnedMatterId: null,
  returnedDocumentId: null,
  returnedDocumentVersionNumber: null,
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
        details: { outputId: 'out_1' },
      },
    ])
    expect(AUDIT_REPORT_VERSION).toBe('obiter.redaction-audit/v2')
    expect(report.reportVersion).toBe(AUDIT_REPORT_VERSION)
    expect(report.detectionMode).toBe('heuristics+supplement')
    expect(report.auditLog).toHaveLength(3)
    expect(report.reviewerInfo).toEqual({
      userId: 'usr_1',
      reviewedAt: '2026-01-01T00:02:00.000Z',
    })
    const schedule = scheduleLines(report).join('\n')
    expect(schedule).toContain('Detection mode: heuristics+supplement')
    expect(schedule).toContain('redaction.span_decision')
    expect(schedule).toContain('usr_1')
  })
})

it('counts an override_keep as visible in the schedule totals', () => {
  const report = buildAuditReport(run, [])
  report.spanDecisions = [
    {
      spanId: 'span_keep',
      spanText: 'Synthetic name',
      category: 'person_name',
      decision: 'override_keep',
      decidedBy: 'usr_1',
      decidedAt: '2026-07-01T12:00:00.000Z',
    },
  ]
  expect(scheduleLines(report)).toContain(
    'Decisions: 0 removed, 1 kept visible',
  )
})

it('omits the confidential source filename from schedules and exports Unicode-named sources', async () => {
  const sourceFilename = 'Synthetic Łucja.docx'
  const report = buildAuditReport({ ...run, sourceFilename }, [])
  expect(scheduleLines(report).join('\n')).not.toContain(sourceFilename)
  expect(scheduleExportFilename('.pdf')).toBe('redaction-schedule.pdf')
  expect(scheduleExportFilename('.docx')).toBe('redaction-schedule.docx')
  const pdf = await renderSchedulePdf(report)
  expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  const docx = await JSZip.loadAsync(await renderScheduleDocx(report))
  const story = await docx.file('word/document.xml')?.async('string')
  expect(story).toBeDefined()
  expect(story).not.toContain(sourceFilename)
})
