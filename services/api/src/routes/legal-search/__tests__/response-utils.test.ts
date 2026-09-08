import { describe, expect, it } from 'vitest'
import type { LegalSearchHit } from '@obiter/search-client'
import { toSummaryHit } from '../response-utils'

function hit(overrides: Partial<LegalSearchHit> = {}): LegalSearchHit {
  return {
    id: 'ewca-civ-2003-231',
    title: 'Donoghue v Folkestone Properties Ltd',
    neutralCitation: '[2003] EWCA Civ 231',
    court: 'ewca-civ',
    jurisdiction: 'england-and-wales',
    dateDecided: '2003-03-27',
    sourceType: 'judgment',
    sourceUrl: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2003/231',
    ...overrides,
  }
}

describe('toSummaryHit match reasons', () => {
  it('labels a single distinctive title term as a partial title match', () => {
    // The misspelled query defeats every whole-title tier, so the rank comes
    // from tier 4. The card must say so even though the body also mentions
    // Donoghue: title evidence outranks body evidence.
    const summary = toSummaryHit(
      hit({
        paragraphs: [
          {
            id: 'ewca-civ-2003-231-p1',
            documentId: 'ewca-civ-2003-231',
            paragraphNumber: 1,
            text: 'Mrs Donoghue brought this claim in negligence.',
          },
        ],
      }),
      'Donoghue v Stevnson',
    )

    expect(summary.matchReason).toBe('partial_title_match')
    expect(summary.retrievalScore).toBe(0.72)
  })

  it('keeps every-term title evidence as a full title match', () => {
    // Rank tier 5: scattered across the title but every query term names
    // this judgment. Previously this fell through to keyword_match because
    // the reason mapping only knew exact and whole-phrase titles.
    const summary = toSummaryHit(
      hit({ title: 'Material v Contribution' }),
      'material contribution',
    )

    expect(summary.matchReason).toBe('title_match')
    expect(summary.retrievalScore).toBe(0.8)
  })

  it('does not promote a title on the bare "v" alone', () => {
    const summary = toSummaryHit(
      hit({ title: 'Smith v Bloggs' }),
      'Donoghue v Stevnson',
    )

    expect(summary.matchReason).toBe('keyword_match')
  })

  it('still labels body-only evidence as a body text match', () => {
    const summary = toSummaryHit(
      hit({
        title: 'Montgomery v Lanarkshire Health Board',
        paragraphs: [
          {
            id: 'montgomery-p1',
            documentId: 'montgomery',
            paragraphNumber: 93,
            text: 'The reasoning of the House of Lords in Donoghue v Stevenson [1932] AC 562 was received similarly.',
          },
        ],
      }),
      'Donoghue v Stevnson',
    )

    // 'stevnson' matches nothing, but 'donoghue' and 'v' are body terms, so
    // a snippet exists without any title evidence.
    expect(summary.matchReason).toBe('body_text_match')
  })

  it('keeps exact citation and id reasons ahead of title evidence', () => {
    expect(toSummaryHit(hit(), '[2003] EWCA Civ 231').matchReason).toBe(
      'exact_neutral_citation',
    )
    expect(toSummaryHit(hit(), 'ewca-civ-2003-231').matchReason).toBe(
      'exact_document_id',
    )
  })
})
