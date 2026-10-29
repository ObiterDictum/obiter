import type { RedactionSpan, SpanCategory } from './types'

// Legal: Court detail is not personal data. A claim number after "Claim No." is a court reference and a court's location is not a person's address, so both are suppressed whichever model head produced them.
const claimNumber =
  /(?<=\b(?:Claim|Case)[ \t]+No[.:]?[ \t]*)[A-Z0-9][A-Z0-9/-]*/g

const courtType = String.raw`(?:County|Crown|High|Family|Magistrates'?)`
const place = String.raw`[A-Z][\p{L}'-]*(?:[ \t]+[A-Z][\p{L}'-]*)*`

const placeAfterCourt = new RegExp(
  String.raw`(?<=\b${courtType}[ \t]+Court[ \t]+at[ \t]+)${place}`,
  'gu',
)

const placeBeforeCourt = new RegExp(
  String.raw`${place}[ \t]+${courtType}[ \t]+Court\b`,
  'gu',
)

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
