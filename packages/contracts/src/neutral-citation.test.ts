import { describe, expect, it } from 'vitest'
import {
  classifyNeutralCitationCandidate,
  neutralCitationPatternSource,
  parseNeutralCitationCandidate,
} from './neutral-citation'

describe('parseNeutralCitationCandidate', () => {
  it.each([
    '[2024] UKSC 22',
    '[2024] UKHL 3',
    '[2024] UKPC 11',
    '[2024] EWCA Civ 7',
    '[2024] EWCA 5',
    '[2024] EWHC 22 (Admin)',
    '[2024] EWFC 4',
    '[2024] EWCOP 12',
    '[2024] UKUT 236 (IAC)',
    '[2024] UKFTT 1074 (TC)',
    '[2024] CSIH 9',
    '[2024] NIQB 6',
  ])('accepts %s', (citation) => {
    expect(parseNeutralCitationCandidate(citation)).toBe(citation)
  })

  it('accepts the case and whitespace differences the canonical fold accepts', () => {
    expect(parseNeutralCitationCandidate('[2024]  uksc   22')).toBe(
      '[2024]  uksc   22',
    )
    expect(parseNeutralCitationCandidate('[2024]\tUKSC 22')).toBe(
      '[2024]\tUKSC 22',
    )
  })

  it('accepts the leading-zero form a tribunal prints unpadded', () => {
    expect(parseNeutralCitationCandidate('[2024] UKUT 00236 (IAC)')).toBe(
      '[2024] UKUT 00236 (IAC)',
    )
  })

  it('drops surrounding whitespace, which is not part of the citation', () => {
    expect(parseNeutralCitationCandidate('  [2024] UKSC 22\n')).toBe(
      '[2024] UKSC 22',
    )
  })

  it.each([
    '[2024 UKSC 22',
    '[[2024]] UKSC 22',
    '2024] UKSC 22',
    '[2024) UKSC 22',
    '[2024] UKSC 22 extra prose',
    '[2024] UKSC 22 and [2024] UKSC 23',
    '[2024] UKSC',
    '[2024] 22',
    'UKSC 22',
    '[2024] EWHC 22 (Admin) (No 2)',
    'Carroll v Taylor [2024] UKSC 22',
  ])('rejects %s', (candidate) => {
    expect(parseNeutralCitationCandidate(candidate)).toBeNull()
  })

  it.each([
    // Fullwidth brackets and digits NFKC-fold to a citation nobody typed.
    '［2024] UKSC 22',
    '[２０２４] UKSC 22',
    '[2024] UKSC ２２',
    // A Cyrillic К is not the ASCII K the grammar names.
    '[2024] UКSC 22',
    '[2024] UKSС 22',
  ])('refuses the lookalike %s', (candidate) => {
    expect(parseNeutralCitationCandidate(candidate)).toBeNull()
  })

  it.each([
    '[2024] UKSC\u000022',
    '[2024] UKSC 22\u0000',
    '[2024] UKSC\u202e 22',
    '[2024] UKSC\u200d22',
  ])('refuses the hidden character in %j', (candidate) => {
    expect(parseNeutralCitationCandidate(candidate)).toBeNull()
  })

  it('keeps a non-breaking space, which the shared folds treat as whitespace', () => {
    expect(parseNeutralCitationCandidate('[2024]\u00a0UKSC 22 ')).toBe(
      '[2024]\u00a0UKSC 22',
    )
  })
})

describe('classifyNeutralCitationCandidate', () => {
  it.each([
    '[2024] UKSC 22',
    '[2024] EWCA Civ 7',
    '[2024] EWHC 22 (Admin)',
    '[2024] UKUT 00236 (IAC)',
    '[2024] CSIH 9',
  ])('classifies the supported citation %s as a citation', (candidate) => {
    expect(classifyNeutralCitationCandidate(candidate)).toBe('citation')
  })

  it.each([
    '[2024] EAT 12',
    '[2024] NICh 3',
    '[2024] ScotCS 7',
    '[2024] ZZZ 12',
    '[2024] EAT 12 (Costs)',
    '[2024] eat 12',
    '[2024]\tEAT\t12',
  ])('classifies the unlisted court in %j as unsupported', (candidate) => {
    expect(classifyNeutralCitationCandidate(candidate)).toBe(
      'unsupported_court',
    )
  })

  it.each([
    '[2024 EAT 12',
    '[[2024]] EAT 12',
    '[2024) EAT 12',
    '[2024] EAT',
    '[2024] 12',
    '[024] EAT 12',
    '[2024] EAT 12 appended prose',
    '[2024] EAT 12 and [2024] EAT 13',
    'Carroll v Taylor [2024] EAT 12',
    '[2024] Foo Bar 12',
    'the policy in [2024] and 12 files',
    '; drop table legal_source_documents',
  ])('classifies the non-citation %j as not a citation', (candidate) => {
    expect(classifyNeutralCitationCandidate(candidate)).toBe('not_a_citation')
  })

  it.each([
    '[２０２４] EAT 12',
    '[2024] EAT １２',
    '[2024] EAT\u202e 12',
    '[2024] EAT\u000012',
  ])('still refuses the lookalike or hidden character in %j', (candidate) => {
    expect(classifyNeutralCitationCandidate(candidate)).toBe('not_a_citation')
  })

  it('keeps the unsupported court out of the supported parse', () => {
    // The classifier is the only place that distinguishes the two; the older
    // parse entry point still returns null for an unlisted court.
    expect(parseNeutralCitationCandidate('[2024] EAT 12')).toBeNull()
    expect(classifyNeutralCitationCandidate('[2024] UKSC 22')).toBe('citation')
  })
})

describe('neutralCitationPatternSource', () => {
  it('scans running prose for candidates, which is what extraction needs', () => {
    const prose =
      'See [2024] UKSC 22 at [12] and [2024] EWCA Civ 7 for the contrary view.'
    const found = [
      ...prose.matchAll(new RegExp(neutralCitationPatternSource, 'g')),
    ]

    expect(found.map((match) => match[0])).toEqual([
      '[2024] UKSC 22',
      '[2024] EWCA Civ 7',
    ])
  })

  it('is case-sensitive when unanchored, so a lowercased mention stays prose', () => {
    const found = 'see [2024] uksc 22'.match(
      new RegExp(neutralCitationPatternSource, 'g'),
    )

    expect(found).toBeNull()
  })
})
