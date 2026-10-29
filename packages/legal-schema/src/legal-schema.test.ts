import { describe, expect, it } from 'bun:test'
import {
  CaseLawJudgeSchema,
  CaseLawSummarySchema,
  LegalAuthoritySchema,
  LegalAuthoritySummarySchema,
  LegalParagraphSchema,
  LegalSourceTypeSchema,
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

  it('defines future source types without treating them as implemented judgment records', () => {
    expect(LegalSourceTypeSchema.parse('legislation_document')).toBe(
      'legislation_document',
    )
    expect(LegalSourceTypeSchema.parse('legislation_provision')).toBe(
      'legislation_provision',
    )
    expect(LegalSourceTypeSchema.parse('international_instrument')).toBe(
      'international_instrument',
    )
    expect(() => LegalSourceTypeSchema.parse('legislation')).toThrow()
  })
})

describe('Case law metadata provenance', () => {
  it('tells a field read from Find Case Law metadata apart from a derived one', () => {
    expect(
      CaseLawJudgeSchema.parse({
        name: 'Lord Reed',
        source: 'fcl_metadata',
        field: 'judge',
      }).source,
    ).toBe('fcl_metadata')
    expect(
      CaseLawJudgeSchema.parse({
        name: 'Lord Reed',
        source: 'extracted',
        field: 'judge',
      }).source,
    ).toBe('extracted')
    expect(() =>
      CaseLawJudgeSchema.parse({
        name: 'Lord Reed',
        source: 'inferred',
        field: 'judge',
      }),
    ).toThrow()
  })

  it('refuses a court summary with no quoted paragraph', () => {
    expect(() =>
      CaseLawSummarySchema.parse({
        paragraphs: [],
        source: 'fcl_metadata',
        field: 'summary',
        sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      }),
    ).toThrow()
    expect(
      CaseLawSummarySchema.parse({
        paragraphs: ['The appeal is dismissed.'],
        source: 'fcl_metadata',
        field: 'summary',
        sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      }).paragraphs,
    ).toEqual(['The appeal is dismissed.'])
  })
})
