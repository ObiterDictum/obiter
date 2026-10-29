import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'
import { applyRedacted, type Decisions } from '@obiter/redaction-policy'
import type {
  Span as RampartSpan,
  TokenClassifier,
} from '@obiter/rampart-inference'
import { buildAuditReport } from './redaction-audit-report'
import {
  renderScheduleDocx,
  renderSchedulePdf,
  scheduleLines,
} from './redaction-schedule-export'
import { computeSummary, type RedactionRunRecord } from './redaction-database'
import { createRedactionDetector } from './redaction-detection'
import { extractDocumentText } from './document-extraction'

const classifier: TokenClassifier = async () => []

function modelSpans(
  text: string,
  value: string,
  label: RampartSpan['label'],
): RampartSpan[] {
  const spans: RampartSpan[] = []
  let start = text.indexOf(value)
  while (start >= 0) {
    spans.push({
      start,
      end: start + value.length,
      label,
      score: 0.99,
      source: 'ner',
      text: value,
    })
    start = text.indexOf(value, start + value.length)
  }
  if (spans.length === 0) throw new Error(`Demo fixture is missing ${value}.`)
  return spans
}

describe('Redact 3 delivered acceptance criteria', () => {
  it('runs the checked-in demo fixture through extraction, detection, review, output and audit', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    const text = await extractDocumentText('docx', fixture)
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => [
        ...modelSpans(masked, 'James Cartwright', 'GIVEN_NAME'),
        ...modelSpans(
          masked,
          '42 Belgrave Road, Leicester LE4 5AB',
          'STREET_NAME',
        ),
      ],
      log: () => undefined,
    })

    const detection = await detect(text)
    expect(detection.degraded).toBe(false)
    expect(detection.spans.length).toBeGreaterThanOrEqual(10)
    expect(detection.spans.map((span) => span.category)).toEqual(
      expect.arrayContaining([
        'person_name',
        'address',
        'email',
        'phone',
        'national_insurance',
        'account_number',
      ]),
    )

    const decidedAt = '2026-07-29T12:00:00.000Z'
    const decisions: Decisions = Object.fromEntries(
      detection.spans.map((span) => [
        span.id,
        {
          decision: 'accept' as const,
          decidedBy: 'usr_demo',
          decidedAt,
        },
      ]),
    )
    const output = applyRedacted(text, detection.spans, decisions)
    expect(output).toContain('[REDACTED]')
    for (const span of detection.spans) expect(output).not.toContain(span.text)

    const summary = {
      ...computeSummary(detection.spans, decisions),
      outputMode: 'redacted' as const,
    }
    const run: RedactionRunRecord = {
      id: 'red_demo',
      organisationId: 'org_demo',
      matterId: null,
      matterName: null,
      documentId: null,
      documentVersionId: null,
      sourceFilename: 'demo-fixture.docx',
      sourceTextObjectKey: 'org/org_demo/redaction-runs/red_demo/source',
      sourceFileObjectKey: null,
      sourceLayoutObjectKey: null,
      sourceMimeType: null,
      status: 'finalized',
      policyMode: 'internal_ai_minimisation',
      spans: detection.spans,
      decisions,
      outputId: 'out_demo',
      summary,
      detectorVersion: detection.detectorVersion,
      detectionMode: 'model+supplement',
      replacesRunId: null,
      replacementRunId: null,
      returnedDocumentVersionId: null,
      returnedMatterId: null,
      returnedDocumentId: null,
      returnedDocumentVersionNumber: null,
      createdBy: 'usr_demo',
      createdAt: decidedAt,
      updatedAt: decidedAt,
      deletedAt: null,
      deletedBy: null,
    }
    const report = buildAuditReport(run, [
      {
        action: 'redaction.run_create',
        userId: 'usr_demo',
        timestamp: decidedAt,
        details: { spanCount: detection.spans.length },
      },
      {
        action: 'redaction.finalize',
        userId: 'usr_demo',
        timestamp: decidedAt,
        details: { outputMode: 'redacted' },
      },
    ])

    expect(report.redactionRunSummary.totalSpans).toBe(detection.spans.length)
    // The exported schedule is a file that leaves the firm's screens: it names
    // what was decided, never the words that were removed.
    const schedule = scheduleLines(report).join('\n')
    expect(schedule).toContain('Obiter redaction schedule')
    for (const span of detection.spans)
      expect(schedule).not.toContain(span.text)
    expect(Buffer.from(await renderSchedulePdf(report)).subarray(0, 4)).toEqual(
      Buffer.from('%PDF'),
    )
    expect(
      Buffer.from(await renderScheduleDocx(report))
        .subarray(0, 2)
        .toString(),
    ).toBe('PK')
  })
})
