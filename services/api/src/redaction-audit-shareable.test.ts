import { describe, expect, it } from 'bun:test'
import { buildAuditReport } from './redaction-audit-report'
import {
  SHAREABLE_AUDIT_VERSION,
  buildShareableAuditReport,
  shareableAuditBytes,
  spanPages,
} from './redaction-audit-shareable'
import type { RedactionRunRecord } from './redaction-database'

const acceptedName = 'Priya Raman'
const sourceFilename = 'client-statement.docx'

const run: RedactionRunRecord = {
  id: 'red_1',
  organisationId: 'org_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename,
  sourceTextObjectKey: 'org/org_1/redaction-runs/red_1/source',
  sourceFileObjectKey: null,
  sourceLayoutObjectKey: null,
  sourceMimeType: null,
  status: 'finalized',
  policyMode: 'internal_ai_minimisation',
  spans: [
    {
      id: 'span_1',
      start: 12,
      end: 12 + acceptedName.length,
      text: acceptedName,
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    },
  ],
  decisions: {
    span_1: {
      decision: 'accept',
      decidedBy: 'usr_1',
      decidedAt: '2026-10-29T09:30:00.000Z',
    },
  },
  outputId: 'out_1',
  summary: {
    totalSpans: 1,
    byCategory: { person_name: 1 } as never,
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
    outputSha256: 'b'.repeat(64),
    securePdf: true,
  },
  detectorVersion: 'rampart-0.1.3',
  detectionMode: 'model+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  returnedMatterId: null,
  returnedDocumentId: null,
  returnedDocumentVersionNumber: null,
  createdBy: 'usr_1',
  createdAt: '2026-10-29T09:00:00.000Z',
  updatedAt: '2026-10-29T09:40:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

const auditLog = [
  {
    action: 'redaction.finalize',
    userId: 'usr_1',
    timestamp: '2026-10-29T09:40:00.000Z',
    details: {},
  },
]

function shareable() {
  const report = buildAuditReport(run, auditLog)
  return {
    report,
    bytes: shareableAuditBytes(
      buildShareableAuditReport(
        report,
        run,
        new Map([['usr_1', 'A. Morgan']]),
        new Map([['span_1', 2]]),
      ),
    ),
  }
}

describe('shareable audit export', () => {
  it('carries the schedule’s facts without the removed words or the source filename', () => {
    const { report, bytes } = shareable()
    const text = new TextDecoder().decode(bytes)

    expect(JSON.stringify(report)).toContain(acceptedName)
    expect(JSON.stringify(report)).toContain(sourceFilename)
    expect(text).not.toContain(acceptedName)
    expect(text).not.toContain(sourceFilename)
    expect(text).not.toContain('client-statement')

    expect(JSON.parse(text)).toEqual({
      reportVersion: SHAREABLE_AUDIT_VERSION,
      redactionRunId: 'red_1',
      generatedAt: report.generatedAt,
      detectionMode: 'model+supplement',
      policyMode: 'internal_ai_minimisation',
      detectorVersion: 'rampart-0.1.3',
      summary: {
        totalSpans: 1,
        byCategory: { person_name: 1 },
        byDecision: {
          accept: 1,
          reject: 0,
          override_redact: 0,
          override_keep: 0,
          pseudonymise: 0,
          undecided: 0,
        },
        removedCount: 1,
        keptCount: 0,
      },
      output: {
        outputMode: 'redacted',
        outputSha256: 'b'.repeat(64),
        securePdf: true,
      },
      reviewedBy: { name: 'A. Morgan', reviewedAt: '2026-10-29T09:40:00.000Z' },
      decisions: [
        {
          category: 'person_name',
          decision: 'accept',
          decidedBy: 'A. Morgan',
          decidedAt: '2026-10-29T09:30:00.000Z',
          page: 2,
        },
      ],
      auditLog: [
        {
          timestamp: '2026-10-29T09:40:00.000Z',
          action: 'redaction.finalize',
          actor: 'A. Morgan',
        },
      ],
    })
  })

  it('leaves the page absent when no layout placed the span', () => {
    const report = buildAuditReport(run, auditLog)
    const shareable = buildShareableAuditReport(
      report,
      run,
      new Map(),
      new Map(),
    )
    expect(shareable.decisions[0]).toMatchObject({
      page: null,
      decidedBy: null,
    })
  })

  it('addresses a decision by the page its span starts on', () => {
    const pages = spanPages(
      {
        version: 2,
        pages: [
          { width: 595, height: 842 },
          { width: 595, height: 842 },
        ],
        segments: [
          {
            start: 0,
            end: 40,
            pageIndex: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            advances: [],
            glyphWidthOverrides: {},
          },
          {
            start: 40,
            end: 80,
            pageIndex: 1,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            advances: [],
            glyphWidthOverrides: {},
          },
        ],
      },
      [{ ...run.spans[0]!, start: 45, end: 50 }],
    )
    expect(pages.get('span_1')).toBe(2)
  })
})
