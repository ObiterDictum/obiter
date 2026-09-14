import { describe, expect, it } from 'vitest'
import {
  createVerificationFindingId,
  decideAuthorityExistence,
  decideCitationResolution,
  normalizedCitationFromResolution,
  requiresReview,
  verificationFindingSchema,
  type CitationInput,
  type CitationResolution,
} from './index'

const subject = { documentId: 'd-1111', versionId: 'v-2' }

function citation(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-7', start: 0, end: rawText.length },
  }
}

const caseLawRaw = citation('[2099] EWCA Civ 7')
const caseLaw: CitationResolution = {
  outcome: 'resolved',
  citation: {
    kind: 'case_law',
    neutralCitation: '[2099] EWCA Civ 7',
    sourceId: 'ewca-civ-2099-7',
  },
}
const wholeAct: CitationResolution = {
  outcome: 'resolved',
  citation: {
    kind: 'legislation',
    documentIdentity: 'ukpga/2099/1',
    labelPath: null,
  },
}
const provision: CitationResolution = {
  outcome: 'resolved',
  citation: {
    kind: 'legislation',
    documentIdentity: 'ukpga/2099/1',
    labelPath: 'section/40',
  },
}

function decide(resolution: CitationResolution, raw = caseLawRaw) {
  return decideCitationResolution({
    subject,
    citation: raw,
    resolution,
  })
}

/** Every outcome the result model can carry, so the table below cannot drift
 * from the union without a typecheck failure. */
const everyResolution: CitationResolution[] = [
  caseLaw,
  { outcome: 'unresolved' },
  { outcome: 'ambiguous' },
  { outcome: 'malformed' },
  { outcome: 'unsupported' },
  { outcome: 'inconclusive', reason: 'store_error' },
  { outcome: 'not_checked' },
]

describe('citation resolution decision', () => {
  it('clears one resolved case-law citation on the stored document identity', () => {
    const finding = decide(caseLaw)

    expect(finding.type).toBe('citation_resolution')
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'judgment',
        granularity: 'document',
        sourceId: 'ewca-civ-2099-7',
      },
    ])
    expect(finding.normalizedCitation).toEqual(caseLaw.citation)
    expect(requiresReview(finding.status)).toBe(false)
  })

  it('clears a whole Act on the Act identity', () => {
    const finding = decide(wholeAct, citation('/ln/ukpga/2099/1'))

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_document',
        granularity: 'document',
        sourceId: 'ukpga/2099/1',
      },
    ])
  })

  it('keeps both the Act identity and the provision path', () => {
    const finding = decide(provision, citation('/ln/ukpga/2099/1/section/40'))

    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.normalizedCitation).toEqual({
      kind: 'legislation',
      documentIdentity: 'ukpga/2099/1',
      labelPath: 'section/40',
    })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2099/1',
        labelPath: 'section/40',
      },
    ])
  })

  it('never clears a whole Act on a provision fragment, or the reverse', () => {
    // The evidence granularity follows the identity, so a resolved citation
    // cannot be cleared on a fragment of a different thing than it names.
    const wholeActFinding = decide(wholeAct, citation('/ln/ukpga/2099/1'))
    const provisionFinding = decide(
      provision,
      citation('/ln/ukpga/2099/1/section/40'),
    )

    expect(wholeActFinding.evidence[0]).toMatchObject({
      granularity: 'document',
    })
    expect(provisionFinding.evidence[0]).toMatchObject({
      granularity: 'fragment',
    })
  })

  it('reports a citation-shaped candidate with no identity as unresolved', () => {
    const finding = decide({ outcome: 'unresolved' })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    expect(finding.normalizedCitation).toEqual({
      kind: 'unresolved',
      reason: 'no_canonical_match',
    })
    expect(finding.evidence).toEqual([])
    expect(requiresReview(finding.status)).toBe(true)
  })

  it('reports multiple identities as ambiguous, never a first-match winner', () => {
    const finding = decide({ outcome: 'ambiguous' })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_ambiguous',
    })
    expect(finding.normalizedCitation).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    })
    expect(finding.evidence).toEqual([])
  })

  it.each([
    ['malformed', 'not_a_citation'],
    ['unsupported', 'unsupported_source_type'],
  ] as const)(
    'reports a %s candidate as outside the accepted grammar',
    (outcome, reason) => {
      const finding = decide({ outcome })

      expect(finding.status).toEqual({
        state: 'review_required',
        reason: 'citation_unresolved',
      })
      expect(finding.normalizedCitation).toEqual({
        kind: 'unresolved',
        reason,
      })
      expect(finding.evidence).toEqual([])
    },
  )

  it('reports a failed dependency as inconclusive, never as no match', () => {
    const finding = decide({ outcome: 'inconclusive', reason: 'store_error' })

    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
    expect(finding.status).not.toEqual({
      state: 'review_required',
      reason: 'citation_unresolved',
    })
    expect(finding.normalizedCitation).toEqual({
      kind: 'unresolved',
      reason: 'resolution_unavailable',
    })
  })

  it('leaves an unrun resolution explicitly not checked', () => {
    const finding = decide({ outcome: 'not_checked' })

    expect(finding.status).toEqual({ state: 'not_checked' })
    expect(finding.severity).toBeNull()
    expect(finding.confidence).toBeNull()
    expect(finding.evidence).toEqual([])
    expect(requiresReview(finding.status)).toBe(true)
  })

  it('never reports authority_not_held, which belongs to the existence check', () => {
    const reasons = everyResolution.map((resolution) => {
      const finding = decide(resolution)
      return finding.status.state === 'review_required'
        ? finding.status.reason
        : finding.status.state
    })

    expect(reasons).not.toContain('authority_not_held')
  })

  it('never claims the authority does not exist', () => {
    for (const resolution of everyResolution) {
      const finding = decide(resolution)
      const text = finding.explanation.toLowerCase()
      expect(text).not.toContain('does not exist')
      expect(text).not.toContain('nonexistent')
      expect(text).not.toContain('fake')
    }
  })

  it('keeps the candidate text out of every explanation', () => {
    const raw = citation('Confidential Matter v Client [2099] EWCA Civ 7')
    for (const resolution of everyResolution) {
      expect(decide(resolution, raw).explanation).not.toContain('Confidential')
      expect(decide(resolution, raw).explanation).not.toContain('[2099]')
    }
  })

  it('produces an accepted finding for every outcome in the result model', () => {
    for (const resolution of everyResolution) {
      const finding = decide(resolution)
      expect(() => verificationFindingSchema.parse(finding)).not.toThrow()
      expect(finding.id).toBe(
        createVerificationFindingId({
          subject,
          type: 'citation_resolution',
          location: caseLawRaw.location,
        }),
      )
    }
  })

  it('keys the finding on subject, type and location, not the resolution', () => {
    const first = decide({ outcome: 'malformed' })
    const second = decide(caseLaw)

    expect(second.id).toBe(first.id)
  })

  it('rejects a candidate whose rawText does not match its location', () => {
    expect(() =>
      decideCitationResolution({
        subject,
        citation: {
          rawText: '[2099] EWCA Civ 7',
          location: { paragraphId: 'p-7', start: 0, end: 3 },
        },
        resolution: caseLaw,
      }),
    ).toThrow()
  })
})

describe('resolution to authority-existence seam', () => {
  it('hands a resolved citation to V2 as a resolved identity', () => {
    const normalized = normalizedCitationFromResolution(caseLaw)
    const finding = decideAuthorityExistence({
      subject,
      citation: caseLawRaw,
      normalizedCitation: normalized,
      outcome: {
        outcome: 'held',
        evidence: [
          {
            sourceType: 'judgment',
            granularity: 'document',
            sourceId: 'ewca-civ-2099-7',
          },
        ],
      },
    })

    expect(finding.status).toEqual({ state: 'clear' })
  })

  it.each(
    everyResolution.filter((resolution) => resolution.outcome !== 'resolved'),
  )(
    'makes the $outcome outcome impossible to enter V2 as a resolved identity',
    (resolution) => {
      const normalized = normalizedCitationFromResolution(resolution)

      expect(normalized.kind).not.toBe('case_law')
      expect(normalized.kind).not.toBe('legislation')
      // V2 refuses a store outcome for a citation with no identity, so a
      // non-resolved result cannot acquire a store verdict by accident.
      expect(() =>
        decideAuthorityExistence({
          subject,
          citation: caseLawRaw,
          normalizedCitation: normalized,
          outcome: { outcome: 'held', evidence: [] },
        }),
      ).toThrow()
    },
  )

  it('lets V2 skip a non-resolved citation rather than clear it', () => {
    for (const resolution of everyResolution) {
      if (resolution.outcome === 'resolved') continue
      const finding = decideAuthorityExistence({
        subject,
        citation: caseLawRaw,
        normalizedCitation: normalizedCitationFromResolution(resolution),
        outcome: { outcome: 'skipped' },
      })

      expect(finding.status.state).not.toBe('clear')
      expect(finding.evidence).toEqual([])
    }
  })
})
