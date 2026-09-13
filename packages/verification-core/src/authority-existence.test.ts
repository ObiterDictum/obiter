import { describe, expect, it } from 'vitest'
import {
  createVerificationFindingId,
  decideAuthorityExistence,
  requiresReview,
  verificationFindingSchema,
  type AuthorityExistenceOutcome,
  type CitationInput,
  type EvidenceReference,
  type NormalizedCitation,
} from './index'

const subject = { documentId: 'd-1111', versionId: 'v-2' }

function citation(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-7', start: 0, end: rawText.length },
  }
}

const caseLawText = '[2099] EWCA Civ 7'
const caseLawRaw = citation(caseLawText)
const caseLaw: NormalizedCitation = {
  kind: 'case_law',
  neutralCitation: caseLawText,
  sourceId: 'uksc-2099-1',
}
const judgmentEvidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    sourceId: 'uksc-2099-1',
    ordinal: 1,
    paragraphNumber: 1,
  },
]

const legislationText = '/ln/ukpga/2010/15/section/40'
const legislationRaw = citation(legislationText)
const legislation: NormalizedCitation = {
  kind: 'legislation',
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/40',
}
const provisionEvidence: EvidenceReference[] = [
  {
    sourceType: 'legislation_provision',
    sourceId: 'ukpga/2010/15',
    labelPath: 'section/40',
  },
]

function decide(overrides: {
  normalizedCitation?: NormalizedCitation
  citation?: CitationInput
  outcome: AuthorityExistenceOutcome
}) {
  return decideAuthorityExistence({
    subject,
    citation: overrides.citation ?? caseLawRaw,
    normalizedCitation: overrides.normalizedCitation ?? caseLaw,
    outcome: overrides.outcome,
  })
}

describe('authority existence decision', () => {
  it('clears a case law citation when exactly one stored source matches', () => {
    const finding = decide({
      outcome: { outcome: 'held', evidence: judgmentEvidence },
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.type).toBe('authority_existence')
    expect(finding.evidence).toEqual(judgmentEvidence)
    expect(finding.evidence[0]?.sourceId).toBe(caseLaw.sourceId)
    expect(requiresReview(finding.status)).toBe(false)
    expect(() => verificationFindingSchema.parse(finding)).not.toThrow()
  })

  it('clears a held legislation provision with matching evidence', () => {
    const finding = decide({
      normalizedCitation: legislation,
      citation: legislationRaw,
      outcome: { outcome: 'held', evidence: provisionEvidence },
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual(provisionEvidence)
  })

  it('requires review for authority_not_held without claiming nonexistence', () => {
    const finding = decide({
      outcome: { outcome: 'not_held', missing: 'authority' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.evidence).toEqual([])
    expect(requiresReview(finding.status)).toBe(true)
    expect(finding.explanation.toLowerCase()).not.toContain('does not exist')
    expect(finding.explanation.toLowerCase()).not.toContain('nonexistent')
    expect(finding.explanation.toLowerCase()).not.toContain('fake')
  })

  it('distinguishes a missing provision from a missing authority', () => {
    const finding = decide({
      normalizedCitation: legislation,
      citation: legislationRaw,
      outcome: { outcome: 'not_held', missing: 'provision' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.explanation.toLowerCase()).toContain('act')
    expect(finding.explanation.toLowerCase()).toContain('held')
  })

  it('treats multiple stored sources as inconclusive, never a winner', () => {
    const finding = decide({ outcome: { outcome: 'ambiguous' } })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.evidence).toEqual([])
  })

  it('reports a store error as inconclusive, distinct from not held', () => {
    const finding = decide({
      outcome: { outcome: 'unavailable', reason: 'store_error' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.status).not.toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
  })

  it('reports a withdrawn source as evidence unavailable', () => {
    const finding = decide({
      outcome: { outcome: 'unavailable', reason: 'source_withdrawn' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
    expect(finding.evidence).toEqual([])
  })

  it('fails closed when the stored identity disagrees with the citation', () => {
    const finding = decide({
      outcome: { outcome: 'unavailable', reason: 'identity_mismatch' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('does not clear a held source with no addressable evidence', () => {
    const finding = decide({ outcome: { outcome: 'held', evidence: [] } })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'evidence_unavailable',
    })
  })

  it('rejects evidence that names a different source than the citation', () => {
    const wrongSource: EvidenceReference[] = [
      {
        sourceType: 'judgment',
        sourceId: 'uksc-2099-9',
        ordinal: 1,
        paragraphNumber: 1,
      },
    ]

    expect(() =>
      decide({ outcome: { outcome: 'held', evidence: wrongSource } }),
    ).toThrow()
  })

  it('forces review when normalisation could not produce an identity', () => {
    const finding = decide({
      normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
      outcome: { outcome: 'skipped' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    expect(finding.evidence).toEqual([])
  })

  it('maps an ambiguous citation to citation_ambiguous, not unclear', () => {
    const finding = decide({
      normalizedCitation: { kind: 'unresolved', reason: 'ambiguous' },
      outcome: { outcome: 'skipped' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_ambiguous',
    })
  })

  it('maps an unsupported source kind to review, never a silent clear', () => {
    const finding = decide({
      normalizedCitation: {
        kind: 'unresolved',
        reason: 'unsupported_source_type',
      },
      outcome: { outcome: 'skipped' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    expect(finding.status.state).not.toBe('clear')
  })

  it('leaves an unrun check explicitly not checked', () => {
    const finding = decide({
      normalizedCitation: { kind: 'not_checked' },
      outcome: { outcome: 'skipped' },
    })

    expect(finding.status).toEqual({ state: 'not_checked' })
    expect(finding.severity).toBeNull()
    expect(finding.confidence).toBeNull()
    expect(finding.evidence).toEqual([])
    expect(requiresReview(finding.status)).toBe(true)
  })

  it('uses a deterministic finding id independent of citation text', () => {
    const first = decide({
      outcome: { outcome: 'held', evidence: judgmentEvidence },
    })
    const other = decideAuthorityExistence({
      subject,
      citation: citation('[2099] EWCA Civ 8'),
      normalizedCitation: {
        kind: 'case_law',
        neutralCitation: '[2099] EWCA Civ 8',
        sourceId: 'uksc-2099-1',
      },
      outcome: { outcome: 'held', evidence: judgmentEvidence },
    })

    expect(first.id).toBe(
      createVerificationFindingId({
        subject,
        type: 'authority_existence',
        location: caseLawRaw.location,
      }),
    )
    expect(other.id).toBe(first.id)
  })

  it('refuses a resolved citation with no store outcome', () => {
    expect(() => decide({ outcome: { outcome: 'skipped' } })).toThrow()
  })

  it('refuses a store outcome for a citation that never reached the store', () => {
    expect(() =>
      decide({
        normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
        outcome: { outcome: 'not_held', missing: 'authority' },
      }),
    ).toThrow()
  })
})
