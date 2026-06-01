import { describe, expect, it } from 'vitest'
import {
  LegalAuthoritySchema,
  LegalAuthoritySummarySchema,
  LegalParagraphSchema,
} from './index'

describe('Legal authority schemas', () => {
  it('validates authority records with paragraphs', () => {
    const authority = LegalAuthoritySchema.parse({
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      court: 'uksc',
      jurisdiction: 'england-and-wales',
      dateDecided: '2024-01-31',
      sourceType: 'judgment',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'The application for permission to bring proceedings under Part III is allowed.',
        },
      ],
    })

    expect(authority.neutralCitation).toBe('[2024] UKSC 3')
    expect(authority.paragraphs).toHaveLength(1)
  })

  it('validates summary records without paragraph text', () => {
    const summary = LegalAuthoritySummarySchema.parse({
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      court: 'uksc',
      jurisdiction: 'england-and-wales',
      dateDecided: '2024-01-31',
      sourceType: 'judgment',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      paragraphs: [
        {
          id: 'uksc-2024-3-p1',
          documentId: 'uksc-2024-3',
          paragraphNumber: 1,
          text: 'The application for permission to bring proceedings under Part III is allowed.',
        },
      ],
    })

    expect(summary).not.toHaveProperty('paragraphs')
  })

  it('allows provider-identified judgments without a neutral citation', () => {
    const summary = LegalAuthoritySummarySchema.parse({
      id: 'd-dd848612-73c3-4719-b18f-5643e51dcb17',
      title: 'NHS England v Justin Yung Hui Chin',
      neutralCitation: null,
      court: 'ftt-phl',
      jurisdiction: 'england-and-wales',
      dateDecided: '2026-02-26',
      sourceType: 'judgment',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/tna.74vv2rbp',
    })

    expect(summary.neutralCitation).toBeNull()
  })

  it('rejects malformed authority and paragraph records', () => {
    expect(() =>
      LegalAuthoritySchema.parse({
        id: '',
        title: 'Broken Authority',
        neutralCitation: '[2024] UKSC 3',
        court: 'uksc',
        jurisdiction: 'england-and-wales',
        dateDecided: '17 January 2024',
        sourceType: 'judgment',
        sourceUrl: 'not a url',
      }),
    ).toThrow()

    expect(() =>
      LegalParagraphSchema.parse({
        id: 'p1',
        documentId: 'doc1',
        paragraphNumber: 0,
        text: '',
      }),
    ).toThrow()
  })

  it('rejects legislation records until a legislation-specific schema exists', () => {
    expect(() =>
      LegalAuthoritySchema.parse({
        id: 'ukpga-1977-37',
        title: 'Patents Act 1977',
        neutralCitation: '1977 c. 37',
        court: 'uk-parliament',
        jurisdiction: 'united-kingdom',
        dateDecided: '1977-07-29',
        sourceType: 'legislation',
        sourceUrl: 'https://www.legislation.gov.uk/ukpga/1977/37/contents',
      }),
    ).toThrow()
  })
})
