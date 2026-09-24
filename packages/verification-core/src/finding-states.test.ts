import { describe, expect, it } from 'bun:test'
import {
  createVerificationFindingId,
  verificationFindingSchema,
  type EvidenceReference,
  type FindingType,
} from './index'

const subject = { documentId: 'd-1111', versionId: 'v-2' }
const citationText = '[2099] EWCA Civ 7'
const citation = {
  rawText: citationText,
  location: { paragraphId: 'p-7', start: 24, end: 24 + citationText.length },
}
const caseLaw = {
  kind: 'case_law',
  neutralCitation: citationText,
  sourceId: 'uksc-2099-1',
}
const legislation = {
  kind: 'legislation',
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/40',
}
const wholeAct = {
  kind: 'legislation',
  documentIdentity: 'ukpga/2010/15',
  labelPath: null,
}
const judgmentEvidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    granularity: 'fragment',
    sourceId: 'uksc-2099-1',
    ordinal: 12,
    paragraphNumber: 9,
  },
]
const judgmentDocumentEvidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    granularity: 'document',
    sourceId: 'uksc-2099-1',
  },
]
const legislationEvidence: EvidenceReference[] = [
  {
    sourceType: 'legislation_provision',
    granularity: 'fragment',
    sourceId: 'ukpga/2010/15',
    labelPath: 'section/40',
  },
]
const legislationDocumentEvidence: EvidenceReference[] = [
  {
    sourceType: 'legislation_document',
    granularity: 'document',
    sourceId: 'ukpga/2010/15',
  },
]

type FindingInput = Record<string, unknown>

/** A coherent finding, so each table row differs from an accepted finding in
 * exactly the way its name says. */
function finding(overrides: FindingInput = {}): FindingInput {
  const type =
    (overrides.type as FindingType | undefined) ?? 'authority_existence'
  return {
    id: createVerificationFindingId({
      subject,
      type,
      location: citation.location,
    }),
    type,
    subject,
    citation,
    normalizedCitation: caseLaw,
    status: { state: 'clear' },
    severity: 'low',
    confidence: 'high',
    evidence: judgmentDocumentEvidence,
    explanation: 'The cited authority is held and the citation matches it.',
    ...overrides,
  }
}

const acceptedStates: Array<[string, FindingInput]> = [
  ['clear on resolved case law with its document evidence', finding()],
  [
    'clear on resolved legislation with its own provision evidence',
    finding({
      normalizedCitation: legislation,
      evidence: legislationEvidence,
    }),
  ],
  [
    'clear on a whole Act with its document evidence',
    finding({
      normalizedCitation: wholeAct,
      evidence: legislationDocumentEvidence,
    }),
  ],
  [
    'flagged on resolved case law with the evidence that shows the problem',
    finding({ status: { state: 'flagged' }, confidence: 'low' }),
  ],
  [
    'flagged on resolved legislation with its own provision evidence',
    finding({
      status: { state: 'flagged' },
      normalizedCitation: legislation,
      evidence: legislationEvidence,
    }),
  ],
  [
    'review required because the citation is unresolved',
    finding({
      status: { state: 'review_required', reason: 'citation_unresolved' },
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required because the citation is ambiguous',
    finding({
      status: { state: 'review_required', reason: 'citation_ambiguous' },
      normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required because the authority is not held',
    finding({
      status: { state: 'review_required', reason: 'authority_not_held' },
      severity: 'high',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required because evidence is unavailable',
    finding({
      status: { state: 'review_required', reason: 'evidence_unavailable' },
      normalizedCitation: legislation,
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required for an inconclusive check that still gathered evidence',
    finding({
      status: { state: 'review_required', reason: 'check_inconclusive' },
      severity: 'medium',
      confidence: 'low',
    }),
  ],
  [
    'review required for an inconclusive check with no evidence',
    finding({
      status: { state: 'review_required', reason: 'check_inconclusive' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'an unrun check that claims nothing',
    finding({
      status: { state: 'not_checked' },
      normalizedCitation: { kind: 'not_checked' },
      severity: null,
      confidence: null,
      evidence: [],
    }),
  ],
]

const rejectedStates: Array<[string, FindingInput]> = [
  ['clear with no evidence', finding({ evidence: [] })],
  [
    'clear on an unresolved citation',
    finding({
      normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      evidence: [],
    }),
  ],
  [
    'clear on a citation that was never checked',
    finding({ normalizedCitation: { kind: 'not_checked' }, evidence: [] }),
  ],
  [
    'clear carrying a review reason',
    finding({ status: { state: 'clear', reason: 'check_inconclusive' } }),
  ],
  [
    'flagged on an unresolved citation, which must force review',
    finding({
      status: { state: 'flagged' },
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      evidence: [],
    }),
  ],
  [
    'flagged with no evidence',
    finding({ status: { state: 'flagged' }, evidence: [] }),
  ],
  [
    'authority_not_held reported as a flag',
    finding({ status: { state: 'flagged', reason: 'authority_not_held' } }),
  ],
  [
    'review required without a reason',
    finding({ status: { state: 'review_required' } }),
  ],
  [
    'review required claiming an unresolved citation it resolved',
    finding({
      status: { state: 'review_required', reason: 'citation_unresolved' },
      normalizedCitation: legislation,
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required claiming an ambiguous citation it resolved',
    finding({
      status: { state: 'review_required', reason: 'citation_ambiguous' },
      normalizedCitation: legislation,
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required calling a non-citation ambiguous',
    finding({
      status: { state: 'review_required', reason: 'citation_ambiguous' },
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required for a missing authority on an unresolved citation',
    finding({
      status: { state: 'review_required', reason: 'authority_not_held' },
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      severity: 'high',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required for missing evidence on an unresolved citation',
    finding({
      status: { state: 'review_required', reason: 'evidence_unavailable' },
      normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'authority_not_held reported by a check that is not authority existence',
    finding({
      type: 'quote_fidelity',
      status: { state: 'review_required', reason: 'authority_not_held' },
      severity: 'high',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'review required for missing evidence that carries evidence',
    finding({
      status: { state: 'review_required', reason: 'evidence_unavailable' },
      normalizedCitation: legislation,
      severity: 'medium',
      confidence: 'low',
      evidence: legislationEvidence,
    }),
  ],
  [
    'review required for an unresolved citation that carries evidence',
    finding({
      status: { state: 'review_required', reason: 'citation_unresolved' },
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      severity: 'medium',
      confidence: 'low',
    }),
  ],
  [
    'review required on a check that never ran the citation normalisation',
    finding({
      status: { state: 'review_required', reason: 'check_inconclusive' },
      normalizedCitation: { kind: 'not_checked' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'evidence for an authority other than the resolved citation',
    finding({
      evidence: [
        {
          sourceType: 'judgment',
          granularity: 'fragment',
          sourceId: 'uksc-2099-2',
          ordinal: 12,
          paragraphNumber: 9,
        },
      ],
    }),
  ],
  [
    'a clear whole-authority finding resting only on a fragment',
    finding({ evidence: judgmentEvidence }),
  ],
  [
    'a clear whole-Act finding resting only on a provision',
    finding({
      normalizedCitation: wholeAct,
      evidence: legislationEvidence,
    }),
  ],
  [
    'a clear quote check resting only on the document',
    finding({
      type: 'quote_fidelity',
      evidence: judgmentDocumentEvidence,
    }),
  ],
  [
    'document evidence on a citation that never resolved',
    finding({
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      evidence: judgmentDocumentEvidence,
    }),
  ],
  [
    'judgment evidence on a legislation citation',
    finding({
      normalizedCitation: legislation,
      evidence: judgmentEvidence,
    }),
  ],
  [
    'legislation evidence on a case law citation',
    finding({ evidence: legislationEvidence }),
  ],
  [
    'legislation evidence for a different Act than the resolved citation',
    finding({
      normalizedCitation: legislation,
      evidence: [
        {
          sourceType: 'legislation_provision',
          granularity: 'fragment',
          sourceId: 'ukpga/1998/42',
          labelPath: 'section/40',
        },
      ],
    }),
  ],
  [
    'the same evidence reference twice',
    finding({
      normalizedCitation: legislation,
      evidence: [legislationEvidence[0], legislationEvidence[0]],
    }),
  ],
  [
    'an unrun check that still resolved the citation',
    finding({
      status: { state: 'not_checked' },
      normalizedCitation: legislation,
      severity: null,
      confidence: null,
      evidence: [],
    }),
  ],
  [
    'an unrun check that invented a severity',
    finding({
      status: { state: 'not_checked' },
      normalizedCitation: { kind: 'not_checked' },
      severity: 'low',
      confidence: null,
      evidence: [],
    }),
  ],
  [
    'an unrun check that invented a confidence',
    finding({
      status: { state: 'not_checked' },
      normalizedCitation: { kind: 'not_checked' },
      severity: null,
      confidence: 'low',
      evidence: [],
    }),
  ],
  [
    'an unrun check resting on evidence',
    finding({
      status: { state: 'not_checked' },
      normalizedCitation: { kind: 'not_checked' },
      severity: null,
      confidence: null,
      evidence: judgmentEvidence,
    }),
  ],
  [
    'a completed check with no severity or confidence',
    finding({ severity: null, confidence: null }),
  ],
  [
    'an id that is not derived from the finding',
    finding({
      id: 'claimant John Smith paid 2m',
      normalizedCitation: legislation,
      evidence: legislationEvidence,
    }),
  ],
  [
    'an id derived from a different draft span',
    finding({
      id: createVerificationFindingId({
        subject,
        type: 'authority_existence',
        location: { ...citation.location, end: citation.location.end + 1 },
      }),
    }),
  ],
  [
    'an id that is the naive delimiter join of its components',
    finding({ id: 'vf:d-1111:v-2:authority_existence:p-7:24-41' }),
  ],
]

describe('Accepted finding states', () => {
  it.each(acceptedStates)('accepts %s', (_name, input) => {
    const result = verificationFindingSchema.safeParse(input)
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })
})

describe('Rejected finding states', () => {
  it.each(rejectedStates)('rejects %s', (_name, input) => {
    expect(verificationFindingSchema.safeParse(input).success).toBe(false)
  })
})
