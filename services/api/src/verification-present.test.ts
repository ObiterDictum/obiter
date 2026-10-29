import { describe, expect, it } from 'bun:test'
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
      not_checked_count: 0,
      dismissed_count: 0,
      document_current_version_id: 'ver_2',
    })
    expect(run.documentVersionId).toBe('ver_1')
    expect(run.stale).toBe(true)
  })

  it('builds the source page and pinpoint from the stored source, and invents neither', () => {
    const subject = { documentId: 'doc_1', versionId: 'ver_1' }
    const location = { paragraphId: 'p1', start: 0, end: 13 }
    const base = {
      type: 'quote_fidelity' as const,
      subject,
      citation: { rawText: 'the court must consider', location },
      normalizedCitation: {
        kind: 'case_law' as const,
        neutralCitation: '[2017] UKSC 24',
        sourceId: 'd-wood',
      },
      status: { state: 'clear' as const },
      severity: null,
      confidence: null,
      explanation: 'The quotation appears in the stored source.',
    }
    const judgment = createVerificationFindingId({
      subject,
      type: 'quote_fidelity',
      location,
    })
    const sources = new Map([
      [
        'judgment:d-wood',
        {
          url: 'https://caselaw.nationalarchives.gov.uk/uksc/2017/24',
          title: 'Wood v Capita Insurance Services Ltd',
          neutralCitation: '[2017] UKSC 24',
        },
      ],
      [
        'legislation:ukpga/2010/15',
        {
          url: 'https://www.legislation.gov.uk/ukpga/2010/15',
          title: null,
          neutralCitation: null,
        },
      ],
    ])
    const paragraph = toPublicFinding(
      {
        ...base,
        id: judgment,
        evidence: [
          {
            sourceType: 'judgment',
            granularity: 'fragment',
            sourceId: 'd-wood',
            ordinal: 10,
            paragraphNumber: 10,
          },
        ],
      },
      { sources },
    )
    expect(paragraph.evidence[0]?.source).toEqual({
      url: 'https://caselaw.nationalarchives.gov.uk/uksc/2017/24',
      canonicalUrl:
        '/case/d-wood-wood-v-capita-insurance-services-ltd-2017-uksc-24',
      pinpoint: 'judgment [10]',
      anchor: 'para-10',
    })

    const wholeAct = toPublicFinding(
      {
        ...base,
        id: judgment,
        type: 'authority_existence',
        normalizedCitation: {
          kind: 'legislation',
          documentIdentity: 'ukpga/2010/15',
          labelPath: null,
        },
        evidence: [
          {
            sourceType: 'legislation_document',
            granularity: 'document',
            sourceId: 'ukpga/2010/15',
          },
        ],
      },
      { sources },
    )
    expect(wholeAct.evidence[0]?.source).toEqual({
      url: 'https://www.legislation.gov.uk/ukpga/2010/15',
      canonicalUrl: '/ln/ukpga/2010/15',
      pinpoint: null,
      anchor: null,
    })

    const provision = toPublicFinding(
      {
        ...base,
        id: judgment,
        type: 'authority_existence',
        normalizedCitation: {
          kind: 'legislation',
          documentIdentity: 'ukpga/2010/15',
          labelPath: 'section/40',
        },
        evidence: [
          {
            sourceType: 'legislation_provision',
            granularity: 'fragment',
            sourceId: 'ukpga/2010/15',
            labelPath: 'section/40',
          },
        ],
      },
      { sources },
    )
    expect(provision.evidence[0]?.source).toEqual({
      url: 'https://www.legislation.gov.uk/ukpga/2010/15',
      canonicalUrl: '/ln/ukpga/2010/15/section/40',
      pinpoint: 'section 40',
      anchor: null,
    })

    const unheld = toPublicFinding({
      ...base,
      id: judgment,
      evidence: [
        {
          sourceType: 'judgment',
          granularity: 'fragment',
          sourceId: 'd-missing',
          ordinal: 3,
          paragraphNumber: null,
        },
      ],
    })
    expect(unheld.evidence[0]?.source).toEqual({
      url: null,
      canonicalUrl: null,
      pinpoint: 'judgment position 3',
      anchor: null,
    })
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
