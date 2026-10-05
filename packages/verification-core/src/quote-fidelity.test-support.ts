import {
  decideQuoteFidelity,
  type CitationInput,
  type NormalizedCitation,
  type QuoteFragment,
  type QuoteSourceOutcome,
  type VerificationSubject,
} from './index'

/**
 * Shared fixtures for the quote-fidelity decision suites. The same subject,
 * citations and fragment builders feed the decision, span and source-integrity
 * tests so they cannot drift from each other.
 */

export const subject: VerificationSubject = {
  documentId: 'd-4',
  versionId: 'v-1',
}

export function span(rawText: string): CitationInput {
  return {
    rawText,
    location: { paragraphId: 'p-4', start: 0, end: rawText.length },
  }
}

export const caseLaw = {
  kind: 'case_law' as const,
  neutralCitation: '[2099] UKSC 1',
  sourceId: 'uksc-2099-1',
} satisfies NormalizedCitation

export const legislation = {
  kind: 'legislation' as const,
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/40',
} satisfies NormalizedCitation

export function paragraph(
  ordinal: number,
  text: string,
  paragraphNumber: number | null = ordinal,
): QuoteFragment {
  return {
    sourceType: 'judgment',
    sourceId: 'uksc-2099-1',
    ordinal,
    paragraphNumber,
    text,
  }
}

export const provision = {
  sourceType: 'legislation_provision' as const,
  sourceId: 'ukpga/2010/15',
  labelPath: 'section/40',
  text: 'A public authority must not act incompatibly with the Convention.',
} satisfies QuoteFragment

/** The stored identity `legislation` resolves to, as the resolver returns it. */
export const resolvedSection40 = {
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/40',
}

export function find(
  quoteText: string,
  normalizedCitation: NormalizedCitation,
  source: QuoteSourceOutcome,
) {
  return decideQuoteFidelity({
    subject,
    quote: span(quoteText),
    normalizedCitation,
    source,
  })
}
