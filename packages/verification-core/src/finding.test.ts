import { describe, expect, it } from 'vitest'
import {
  createVerificationFindingId,
  requiresReview,
  verificationFindingSchema,
  type EvidenceReference,
  type FindingStatus,
  type VerificationFinding,
} from './index'

const subject = { documentId: 'd-1111', versionId: 'v-2' }
const citation = {
  rawText: '[2099] EWCA Civ 7',
  location: { paragraphId: 'p-7', start: 24, end: 40 },
}
const evidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    sourceId: 'uksc-2099-1',
    ordinal: 12,
    paragraphNumber: 9,
  },
]

const clearFinding = {
  id: 'vf:d-1111:v-2:authority_existence:p-7:24-40',
  type: 'authority_existence',
  subject,
  citation,
  normalizedCitation: {
    kind: 'case_law',
    neutralCitation: '[2099] EWCA Civ 7',
  },
  status: { state: 'clear' },
  severity: 'low',
  confidence: 'high',
  evidence,
  explanation: 'The cited authority is held and the citation matches it.',
} satisfies VerificationFinding

describe('Verification findings', () => {
  it('parses a clear finding backed by evidence', () => {
    expect(verificationFindingSchema.parse(clearFinding)).toEqual(clearFinding)
  })

  it('parses a review-required finding with its reason', () => {
    const finding = verificationFindingSchema.parse({
      ...clearFinding,
      status: { state: 'review_required', reason: 'authority_not_held' },
      confidence: 'low',
      evidence: [],
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
  })

  it('rejects a review-required state with no reason', () => {
    expect(() =>
      verificationFindingSchema.parse({
        ...clearFinding,
        status: { state: 'review_required' },
      }),
    ).toThrow()
  })
})

describe('Finding status handling', () => {
  const cases: Array<[FindingStatus, boolean]> = [
    [{ state: 'clear' }, false],
    [{ state: 'flagged' }, false],
    [{ state: 'not_checked' }, true],
    [{ state: 'review_required', reason: 'check_inconclusive' }, true],
  ]

  it.each(cases)('decides whether %o requires review', (status, expected) => {
    expect(requiresReview(status)).toBe(expected)
  })

  it('treats an unrun check as unknown rather than a pass', () => {
    expect(requiresReview({ state: 'not_checked' })).toBe(true)
  })
})

describe('Contradictory finding state', () => {
  it('refuses to clear a check on an unresolved citation', () => {
    expect(() =>
      verificationFindingSchema.parse({
        ...clearFinding,
        normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      }),
    ).toThrow()
  })

  it('refuses a clear finding with no evidence behind it', () => {
    expect(() =>
      verificationFindingSchema.parse({ ...clearFinding, evidence: [] }),
    ).toThrow()
  })

  it('rejects a status carrying a review reason it cannot have', () => {
    expect(() =>
      verificationFindingSchema.parse({
        ...clearFinding,
        status: { state: 'clear', reason: 'check_inconclusive' },
      }),
    ).toThrow()
  })

  it('rejects unknown fields rather than ignoring them', () => {
    expect(() =>
      verificationFindingSchema.parse({ ...clearFinding, claimId: 'c-1' }),
    ).toThrow()
  })
})

describe('Finding identity', () => {
  const input = {
    subject,
    type: 'authority_existence',
    location: citation.location,
  } as const

  it('is stable for the same subject, check and location', () => {
    expect(createVerificationFindingId(input)).toBe(
      createVerificationFindingId({ ...input }),
    )
  })

  it('changes with the check, the location or the subject version', () => {
    const id = createVerificationFindingId(input)
    expect(
      createVerificationFindingId({ ...input, type: 'quote_fidelity' }),
    ).not.toBe(id)
    expect(
      createVerificationFindingId({
        ...input,
        location: { ...citation.location, end: 41 },
      }),
    ).not.toBe(id)
    expect(
      createVerificationFindingId({
        ...input,
        subject: { ...subject, versionId: 'v-3' },
      }),
    ).not.toBe(id)
  })

  it('is built from ids and offsets, not citation or draft text', () => {
    const id = createVerificationFindingId(input)
    expect(id).not.toContain('[2099]')
    expect(id).not.toContain('claimant')
  })
})

describe('Matter content does not leak into finding metadata', () => {
  it('serialises the citation without the draft prose around it', () => {
    const draftParagraph =
      'The claimant cites the authority in [2099] EWCA Civ 7 and adopts it.'
    const start = draftParagraph.indexOf('[2099] EWCA Civ 7')
    const citationInput = {
      rawText: draftParagraph.slice(start, start + '[2099] EWCA Civ 7'.length),
      location: {
        paragraphId: 'p-7',
        start,
        end: start + '[2099] EWCA Civ 7'.length,
      },
    }

    const finding = verificationFindingSchema.parse({
      ...clearFinding,
      id: createVerificationFindingId({
        subject,
        type: 'authority_existence',
        location: citationInput.location,
      }),
      citation: citationInput,
    })
    const serialised = JSON.stringify(finding)

    expect(serialised).toContain('[2099] EWCA Civ 7')
    expect(serialised).not.toContain('The claimant cites the authority in')
    expect(finding.id).not.toContain('claimant')
    expect(Object.keys(finding.citation.location).sort()).toEqual([
      'end',
      'paragraphId',
      'start',
    ])
  })
})
