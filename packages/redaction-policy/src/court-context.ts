import type { RedactionSpan, SpanCategory } from './types'

// The NER is US-trained, so its identifier and address heads fire on UK court
// detail that carries no personal data: a claim number after "Claim No." reads
// as a driving licence, and a court's location reads as a personal address.
// The v2 label policy treats court names as hard negatives, and a claim number
// is a court reference, not a personal identifier. Suppression keys off the
// surrounding text rather than the label, so the same misfire is dropped
// whichever head, or later checkpoint, produced it.
const claimNumber =
  /(?<=\b(?:Claim|Case)[ \t]+No[.:]?[ \t]*)[A-Z0-9][A-Z0-9/-]*/g

const courtType = String.raw`(?:County|Crown|High|Family|Magistrates'?)`
const place = String.raw`[A-Z][\p{L}'-]*(?:[ \t]+[A-Z][\p{L}'-]*)*`

// "County Court at Leicester": the place follows the court's name.
const placeAfterCourt = new RegExp(
  String.raw`(?<=\b${courtType}[ \t]+Court[ \t]+at[ \t]+)${place}`,
  'gu',
)

// "Leicester County Court": the place precedes it. Only horizontal whitespace
// joins the words, so a place cannot swallow the next line of the document.
const placeBeforeCourt = new RegExp(
  String.raw`${place}[ \t]+${courtType}[ \t]+Court\b`,
  'gu',
)

/** Categories that assert a person's identifier, never a court reference. */
const personalIdentifiers = new Set<SpanCategory>([
  'drivers_license',
  'government_id',
  'account_number',
  'passport',
  'national_insurance',
])

function ranges(text: string, pattern: RegExp): Array<[number, number]> {
  return [...text.matchAll(pattern)].map((match) => [
    match.index,
    match.index + match[0].length,
  ])
}

function within(span: RedactionSpan, bounds: Array<[number, number]>) {
  return bounds.some(([start, end]) => span.start >= start && span.end <= end)
}

/**
 * Drop spans that only look personal because of court detail around them.
 *
 * The test is containment, so a span the merge union widened across a genuine
 * neighbouring detection is left alone: the guard can fail to suppress, never
 * discard a real identifier that merely overlaps one.
 */
export function suppressCourtContextSpans(
  text: string,
  spans: RedactionSpan[],
): RedactionSpan[] {
  const claimNumbers = ranges(text, claimNumber)
  const courtPlaces = [
    ...ranges(text, placeAfterCourt),
    ...ranges(text, placeBeforeCourt),
  ]
  return spans.filter((span) => {
    if (span.category === 'address') return !within(span, courtPlaces)
    if (personalIdentifiers.has(span.category))
      return !within(span, claimNumbers)
    return true
  })
}
