import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createSyntheticDocx } from '@obiter/ooxml'
import type { SpanDecision } from '@obiter/contracts'
import type { buildAuditReport } from './redaction-audit-report'

type AuditReport = ReturnType<typeof buildAuditReport>

const decisionWords = {
  accept: 'Redacted',
  override_redact: 'Redacted (override)',
  pseudonymise: 'Pseudonymised',
  reject: 'Kept visible',
  override_keep: 'Kept visible (override)',
} satisfies Record<SpanDecision, string>

const timestampFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

function when(value: string) {
  return timestampFormat.format(new Date(value))
}

/**
 * The schedule as a reader sees it. The removed words are deliberately absent:
 * the schedule is a file that gets emailed and printed, and reproducing the text
 * it proves was removed would carry the disclosure risk into the audit file.
 * Each row is addressed by its position in the decision list instead.
 */
export function scheduleLines(report: AuditReport): string[] {
  const decisions = report.spanDecisions
  const kept = decisions.filter(
    (entry) =>
      entry.decision === 'reject' || entry.decision === 'override_keep',
  ).length
  const removed = decisions.length - kept
  return [
    'Obiter redaction schedule',
    '',
    `Run: ${report.redactionRunId}`,
    `Source: ${report.originalDocument.filename}`,
    `Generated: ${when(report.generatedAt)}`,
    `Detection mode: ${report.detectionMode}`,
    `Policy: ${report.policyMode}`,
    `Detector: ${report.detectorVersion ?? 'not recorded'}`,
    `Spans decided: ${decisions.length} of ${report.redactionRunSummary.totalSpans}`,
    `Decisions: ${removed} removed, ${kept} kept visible`,
    '',
    'The removed words are not reproduced in this file. The run record holds',
    'them for anyone with access to the run.',
    '',
    'Decisions',
    ...decisions.map(
      (entry, index) =>
        `${index + 1}. ${entry.category.replaceAll('_', ' ')} — ${decisionWords[entry.decision]} — ${entry.decidedBy} — ${when(entry.decidedAt)}`,
    ),
    '',
    'Audit log',
    ...report.auditLog.map(
      (entry) =>
        `${when(entry.timestamp)} — ${entry.action} — ${entry.userId ?? 'system'}`,
    ),
  ]
}

/** A4, 10pt, one line of text per schedule line, wrapped to the page width. */
export async function renderSchedulePdf(report: AuditReport) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 48
  const lineHeight = 13
  const maxWidth = pageWidth - margin * 2
  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const write = (line: string) => {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
    page.drawText(line, { x: margin, y, size: 10, font })
    y -= lineHeight
  }
  const wrap = (line: string) => {
    if (!line) return ['']
    let rest = line
    const output: string[] = []
    while (rest.length > 0) {
      let cut = rest.length
      while (
        cut > 1 &&
        font.widthOfTextAtSize(rest.slice(0, cut), 10) > maxWidth
      )
        cut -= 1
      output.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    return output
  }

  for (const line of scheduleLines(report))
    for (const wrapped of wrap(line)) write(wrapped)
  return pdf.save()
}

/**
 * The Word export is the same plain lines, one paragraph each. The package
 * builder is the one already in `@obiter/ooxml`; a schedule needs no styling
 * fidelity, so building a styled document here would be work with no reader.
 */
export async function renderScheduleDocx(report: AuditReport) {
  return createSyntheticDocx(scheduleLines(report))
}

/** `witness-statement-shah.docx` → `witness-statement-shah-schedule.pdf`. */
export function scheduleExportFilename(
  sourceFilename: string,
  extension: '.pdf' | '.docx',
) {
  const stem = sourceFilename.replace(/\.[^.]+$/u, '') || sourceFilename
  return `${stem}-schedule${extension}`
}
