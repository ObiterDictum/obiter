import type { CitationInput } from './citation'

/**
 * The quotation's own draft span. It is the same verbatim half-open slice
 * `CitationInput` describes (raw text plus a UTF-16 `DraftLocation`, length
 * pinned), reused rather than redefined so a quotation cannot carry a different
 * offset convention. V4's finding records the quotation in its `citation`
 * field: V1 keys `createVerificationFindingId` on that field's location, and
 * keying a quotation on the citation's location instead would collide for two
 * quotations attributed to the same citation occurrence.
 *
 * Every decision requires a structurally valid span. `QuoteSpan` is already the
 * schema-validated `CitationInput` type, so a violation here is a caller that
 * bypassed V1's schema; `quoteSpanViolation` gives that case a named contract
 * instead of a schema error raised from inside a comparison.
 */
export type QuoteSpan = CitationInput

/** How a quotation span violates V1's `CitationInput` contract. */
export type QuoteSpanViolation = 'blank' | 'length_mismatch'

/**
 * The one owner of the quotation-span contract. A blank quotation and a
 * quotation whose text is not the slice its location names are both refusals at
 * the boundary rather than comparison outcomes: V1's finding model records the
 * quotation in its `citation` field, and `citationInputSchema` refuses a blank
 * `rawText`, so a blank quotation has no representable finding. A quotation that
 * is non-blank but reduces to no comparable text under the permitted folds is a
 * different case, and does have one: `empty_quote`, review required.
 */
export function quoteSpanViolation(
  quote: QuoteSpan,
): QuoteSpanViolation | null {
  if (quote.rawText.trim().length === 0) return 'blank'
  if (quote.rawText.length !== quote.location.end - quote.location.start) {
    return 'length_mismatch'
  }
  return null
}

/** A quotation span that V1's `CitationInput` cannot carry. Raised before any
 * comparison runs, so it never depends on a source being held. */
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
