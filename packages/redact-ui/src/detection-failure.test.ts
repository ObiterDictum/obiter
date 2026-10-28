import { describe, expect, it } from 'bun:test'
import { detectionFailureMessage } from './detection-failure'
import type { RedactionRun } from './types'

function failedRun(overrides: Partial<RedactionRun>): RedactionRun {
  return {
    id: 'red_1',
    matterId: null,
    matterName: null,
    documentId: null,
    documentVersionId: null,
    sourceFilename: 'document.docx',
    sourceMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    status: 'failed',
    policyMode: 'internal_ai_minimisation',
    spans: [],
    decisions: {},
    outputId: null,
    detectorVersion: null,
    detectionMode: 'model+supplement',
    replacesRunId: null,
    replacementRunId: null,
    summary: {
      totalSpans: 0,
      byCategory: {} as RedactionRun['summary']['byCategory'],
      bySource: { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 },
      reviewedCount: 0,
      unreviewedCount: 0,
    },
    createdAt: '2026-10-26T14:00:00.000Z',
    updatedAt: '2026-10-26T14:00:00.000Z',
    ...overrides,
  }
}

describe('detectionFailureMessage', () => {
  it('never describes a Word document failure in PDF words', () => {
    // The stored reason came from a PDF run; the reviewer is holding a .docx.
    const message = detectionFailureMessage(
      failedRun({
        summary: {
          ...failedRun({}).summary,
          failureReason: 'No text layer was found in this PDF.',
        },
      }),
    )
    expect(message).toContain('Word document')
    expect(message).not.toMatch(/pdf|text layer/iu)
  })

  it('keeps a reason that names the file type the reviewer has', () => {
    expect(
      detectionFailureMessage(
        failedRun({
          sourceFilename: 'scan.pdf',
          sourceMimeType: 'application/pdf',
          summary: {
            ...failedRun({}).summary,
            failureReason: 'No text layer was found in this PDF.',
          },
        }),
      ),
    ).toBe('No text layer was found in this PDF.')
  })

  it('states what a scanned PDF needs when no reason was recorded', () => {
    const message = detectionFailureMessage(
      failedRun({
        sourceFilename: 'scan.pdf',
        sourceMimeType: 'application/pdf',
      }),
    )
    expect(message).toContain('scanned')
    expect(message).toContain('OCR')
  })
})
