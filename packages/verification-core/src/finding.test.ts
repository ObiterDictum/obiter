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
const citationText = '[2099] EWCA Civ 7'
const citation = {
  rawText: citationText,
  location: { paragraphId: 'p-7', start: 24, end: 24 + citationText.length },
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
  id: createVerificationFindingId({
    subject,
    type: 'authority_existence',
    location: citation.location,
  }),
  type: 'authority_existence',
  subject,
  citation,
  normalizedCitation: {
    kind: 'case_law',
    neutralCitation: citationText,
    sourceId: 'uksc-2099-1',
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

  it('rejects a status carrying a review reason it cannot have', () => {
    expect(() =>
      verificationFindingSchema.parse({
        ...clearFinding,
        status: { state: 'clear', reason: 'check_inconclusive' },
      }),
    ).toThrow()
    expect(() =>
      verificationFindingSchema.parse({
        ...clearFinding,
        status: { state: 'flagged', reason: 'authority_not_held' },
      }),
    ).toThrow()
  })

  it('rejects unknown fields rather than ignoring them', () => {
    expect(() =>
      verificationFindingSchema.parse({ ...clearFinding, claimId: 'c-1' }),
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

/** Decodes the length-prefixed component encoding, so a value that contains
 * `:` cannot be mistaken for a delimiter. */
function decodeFindingId(id: string): string[] {
  expect(id.startsWith('vf:')).toBe(true)
  const values: string[] = []
  let cursor = 3
  while (cursor < id.length) {
    const separator = id.indexOf(':', cursor)
    expect(separator).toBeGreaterThan(cursor)
    const length = Number(id.slice(cursor, separator))
    expect(Number.isInteger(length)).toBe(true)
    values.push(id.slice(separator + 1, separator + 1 + length))
    cursor = separator + 1 + length + 1
  }
  return values
}

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
        location: { ...citation.location, end: citation.location.end + 1 },
      }),
    ).not.toBe(id)
    expect(
      createVerificationFindingId({
        ...input,
        subject: { ...subject, versionId: 'v-3' },
      }),
    ).not.toBe(id)
  })

  it('does not collapse two subjects when a component contains the delimiter', () => {
    const left = createVerificationFindingId({
      ...input,
      subject: { documentId: 'a:b', versionId: 'c' },
    })
    const right = createVerificationFindingId({
      ...input,
      subject: { documentId: 'a', versionId: 'b:c' },
    })

    expect(left).not.toBe(right)
  })

  it('encodes each component so it decodes back exactly', () => {
    const id = createVerificationFindingId({
      subject: { documentId: 'a:b', versionId: 'c' },
      type: 'quote_fidelity',
      location: { paragraphId: 'p:7', start: 24, end: 41 },
    })

    expect(decodeFindingId(id)).toEqual([
      'a:b',
      'c',
      'quote_fidelity',
      'p:7',
      '24',
      '41',
    ])
  })

  it('keeps an empty component distinguishable from a missing one', () => {
    const empty = createVerificationFindingId({
      subject: { documentId: '', versionId: 'ab' },
      type: 'authority_existence',
      location: citation.location,
    })
    const shifted = createVerificationFindingId({
      subject: { documentId: 'a', versionId: 'b' },
      type: 'authority_existence',
      location: citation.location,
    })

    expect(empty).not.toBe(shifted)
    expect(decodeFindingId(empty)[0]).toBe('')
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
    const start = draftParagraph.indexOf(citationText)
    const citationInput = {
      rawText: draftParagraph.slice(start, start + citationText.length),
      location: {
        paragraphId: 'p-7',
        start,
        end: start + citationText.length,
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

    expect(serialised).toContain(citationText)
    expect(serialised).not.toContain('The claimant cites the authority in')
    expect(finding.id).not.toContain('claimant')
    expect(Object.keys(finding.citation.location).sort()).toEqual([
      'end',
      'paragraphId',
      'start',
    ])
  })
})
