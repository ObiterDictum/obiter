import { describe, expect, it } from 'bun:test'
import {
  isFindCaseLawSource,
  judgmentExtractLabel,
  sourceNameForUrl,
  snippetParagraphHash,
} from './provenance'

describe('source provenance', () => {
  it('identifies only the Find Case Law host without URL.canParse', () => {
    const descriptor = Object.getOwnPropertyDescriptor(URL, 'canParse')
    Reflect.deleteProperty(URL, 'canParse')
    try {
      expect(
        isFindCaseLawSource(
          'https://caselaw.nationalarchives.gov.uk/uksc/2018/24',
        ),
      ).toBe(true)
      expect(
        isFindCaseLawSource(
          'https://caselaw.nationalarchives.gov.uk.example.org/uksc/2018/24',
        ),
      ).toBe(false)
      expect(isFindCaseLawSource('caselaw.nationalarchives.gov.uk')).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(URL, 'canParse', descriptor)
    }
  })

  it('names the two stored sources from their URLs', () => {
    expect(
      sourceNameForUrl('https://caselaw.nationalarchives.gov.uk/uksc/2018/24'),
    ).toBe('The National Archives (Find Case Law)')
    expect(
      sourceNameForUrl('https://www.legislation.gov.uk/ukpga/2010/15'),
    ).toBe('legislation.gov.uk')
  })

  it('falls back to the host instead of naming a source it does not know', () => {
    expect(sourceNameForUrl('https://example.org/judgment/1')).toBe(
      'example.org',
    )
    expect(sourceNameForUrl('not a url')).toBe('not a url')
  })

  it('labels an extract with the pinpoint the data carries', () => {
    expect(
      judgmentExtractLabel({
        paragraphNumber: 121,
        text: 'The appeal is allowed.',
        matchedTerms: [],
      }),
    ).toBe('Judgment extract · judgment [121]')
    expect(
      snippetParagraphHash({
        paragraphNumber: 121,
        text: 'The appeal is allowed.',
        matchedTerms: [],
      }),
    ).toBe('para-121')
  })
})
