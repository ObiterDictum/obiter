import { describe, expect, it } from 'bun:test'
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
const judgmentFragmentEvidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    granularity: 'fragment',
    sourceId: 'uksc-2099-1',
    ordinal: 1,
    paragraphNumber: 1,
  },
]
const judgmentDocumentEvidence: EvidenceReference[] = [
  {
    sourceType: 'judgment',
    granularity: 'document',
    sourceId: 'uksc-2099-1',
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
    granularity: 'fragment',
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
  it('clears a case law citation with document-level evidence, not a paragraph', () => {
    const finding = decide({
      outcome: { outcome: 'held', evidence: judgmentDocumentEvidence },
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.type).toBe('authority_existence')
    expect(finding.evidence).toEqual(judgmentDocumentEvidence)
    expect(finding.evidence[0]?.sourceId).toBe(caseLaw.sourceId)
    expect(requiresReview(finding.status)).toBe(false)
    expect(() => verificationFindingSchema.parse(finding)).not.toThrow()
  })

  it('refuses to clear a whole-authority finding on a fragment alone', () => {
    // A paragraph the check never read is not proof of the document, so a
    // fragment cannot substitute for the document identity.
    expect(() =>
      decide({
        outcome: { outcome: 'held', evidence: judgmentFragmentEvidence },
      }),
    ).toThrow()
  })

  it('allows a fragment in addition to the document identity', () => {
    const finding = decide({
      outcome: {
        outcome: 'held',
        evidence: [...judgmentDocumentEvidence, ...judgmentFragmentEvidence],
      },
    })

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toHaveLength(2)
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

  it('clears a whole Act with document-level evidence', () => {
    const wholeAct: NormalizedCitation = {
      kind: 'legislation',
      documentIdentity: 'ukpga/2010/15',
      labelPath: null,
    }
    const finding = decide({
      normalizedCitation: wholeAct,
      citation: citation('/ln/ukpga/2010/15'),
      outcome: {
        outcome: 'held',
        evidence: [
          {
            sourceType: 'legislation_document',
            granularity: 'document',
            sourceId: 'ukpga/2010/15',
          },
        ],
      },
    })

    expect(finding.status).toEqual({ state: 'clear' })
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

  it('rejects the impossible case law missing-provision pairing', () => {
    // Case law has no provisions, so this pairing is contradictory rather than
    // an unreachable branch waiting to be emitted for a judgment.
    expect(() =>
      decide({ outcome: { outcome: 'not_held', missing: 'provision' } }),
    ).toThrow()
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

  it('reports a malformed stored record as inconclusive with its own wording', () => {
    const malformed = decide({
      outcome: { outcome: 'unavailable', reason: 'malformed_record' },
    })
    const storeError = decide({
      outcome: { outcome: 'unavailable', reason: 'store_error' },
    })

    expect(malformed.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(malformed.explanation).not.toBe(storeError.explanation)
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
    // Correct for one withdrawn match and for several.
    expect(finding.explanation.toLowerCase()).toContain('every')
  })

  it('reports an underspecified schedule citation as inconclusive, not not-held', () => {
    const finding = decide({
      normalizedCitation: legislation,
      citation: legislationRaw,
      outcome: { outcome: 'unavailable', reason: 'citation_underspecified' },
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

  it('fails closed when the stored identity disagrees with the citation', () => {
    const finding = decide({
      outcome: { outcome: 'unavailable', reason: 'identity_mismatch' },
    })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('does not clear a held source with no evidence at all', () => {
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
        granularity: 'document',
        sourceId: 'uksc-2099-9',
      },
    ]

    expect(() =>
      decide({ outcome: { outcome: 'held', evidence: wrongSource } }),
    ).toThrow()
  })

  it('rejects cross-source document evidence', () => {
    const crossSource: EvidenceReference[] = [
      {
        sourceType: 'legislation_document',
        granularity: 'document',
        sourceId: 'ukpga/2010/15',
      },
    ]

    expect(() =>
      decide({ outcome: { outcome: 'held', evidence: crossSource } }),
    ).toThrow()
  })

  it('rejects document evidence on a citation with no identity', () => {
    expect(() =>
      decide({
        normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
        outcome: { outcome: 'skipped' },
      }),
    ).not.toThrow()
    expect(() =>
      verificationFindingSchema.parse({
        id: createVerificationFindingId({
          subject,
          type: 'authority_existence',
          location: caseLawRaw.location,
        }),
        type: 'authority_existence',
        subject,
        citation: caseLawRaw,
        normalizedCitation: { kind: 'unresolved', reason: 'not_a_citation' },
        status: { state: 'clear' },
        severity: 'low',
        confidence: 'high',
        evidence: judgmentDocumentEvidence,
        explanation: 'Cleared without an identity.',
      }),
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
      outcome: { outcome: 'held', evidence: judgmentDocumentEvidence },
    })
    const other = decideAuthorityExistence({
      subject,
      citation: citation('[2099] EWCA Civ 8'),
      normalizedCitation: {
        kind: 'case_law',
        neutralCitation: '[2099] EWCA Civ 8',
        sourceId: 'uksc-2099-1',
      },
      outcome: { outcome: 'held', evidence: judgmentDocumentEvidence },
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
