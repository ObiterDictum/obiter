import type { CitationInput } from './citation'

export type QuoteSpan = CitationInput

export type QuoteSpanViolation = 'blank' | 'length_mismatch'

export function quoteSpanViolation(
  quote: QuoteSpan,
): QuoteSpanViolation | null {
  if (quote.rawText.trim().length === 0) return 'blank'
  if (quote.rawText.length !== quote.location.end - quote.location.start) {
    return 'length_mismatch'
  }
  return null
}

export class QuoteSpanInvalidError extends Error {
  readonly violation: QuoteSpanViolation

  constructor(violation: QuoteSpanViolation) {
    super(
      violation === 'blank'
        ? 'A quotation must carry comparable text; a blank quotation has no finding.'
        : 'A quotation must be the draft slice its location names.',
    )
    this.name = 'QuoteSpanInvalidError'
    this.violation = violation
  }
}
