import { describe, expect, it } from 'vitest'
import {
  createEvidenceReferenceId,
  createVerificationFindingId,
} from '@obiter/verification-core'
import { toPublicFinding, toPublicRun } from './verification-present'

describe('verification presenters', () => {
  it('does not retarget a run when the current version has moved', () => {
    const run = toPublicRun({
      id: 'vrun_1',
      organisation_id: 'org_1',
      matter_id: 'mtr_1',
      document_id: 'doc_1',
      document_version_id: 'ver_1',
      status: 'completed',
      failure_code: null,
      created_by: 'usr_1',
      created_at: '2026-09-14T00:00:00.000Z',
      started_at: '2026-09-14T00:00:01.000Z',
      completed_at: '2026-09-14T00:00:02.000Z',
      finding_count: 1,
      flagged_count: 0,
      review_required_count: 1,
      document_current_version_id: 'ver_2',
    })
    expect(run.documentVersionId).toBe('ver_1')
    expect(run.stale).toBe(true)
  })

  it('exposes the V1 evidence identity rather than an internal discriminant', () => {
    const subject = { documentId: 'doc_1', versionId: 'ver_1' }
    const location = { paragraphId: 'p1', start: 0, end: 13 }
    const evidence = {
      sourceType: 'judgment' as const,
      granularity: 'document' as const,
      sourceId: 'uksc-1',
    }
    const finding = toPublicFinding({
      id: createVerificationFindingId({
        subject,
        type: 'authority_existence',
        location,
      }),
      type: 'authority_existence',
      subject,
      citation: { rawText: '[2024] UKSC 1', location },
      normalizedCitation: {
        kind: 'case_law',
        neutralCitation: '[2024] UKSC 1',
        sourceId: 'uksc-1',
      },
      status: { state: 'clear' },
      severity: 'medium',
      confidence: 'high',
      evidence: [evidence],
      explanation: 'The stored sources hold this authority.',
    })
    expect(finding.evidence[0]?.id).toBe(createEvidenceReferenceId(evidence))
    expect(finding.evidence[0]?.label).toContain('uksc-1')
    expect(finding.authorityLabel).toBe('[2024] UKSC 1')
  })
})
