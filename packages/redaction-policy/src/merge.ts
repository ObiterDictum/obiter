import type { RedactionSpan, SpanCategory, SpanSuggestion } from './types'

const redactByDefault = new Set<SpanCategory>([
  'person_name',
  'email',
  'phone',
  'address',
  'government_id',
  'account_number',
  'passport',
  'drivers_license',
  'national_insurance',
  'ip_address',
  'secret',
])

export function suggestedAction(category: SpanCategory, isDateOfBirth = false): SpanSuggestion {
  if (category === 'date') return isDateOfBirth ? 'redact' : 'keep'
  return redactByDefault.has(category) ? 'redact' : 'keep'
}

function overlaps(left: RedactionSpan, right: RedactionSpan) {
  return left.start < right.end && right.start < left.end
}

export function mergeSpans(rampartSpans: RedactionSpan[], supplementSpans: RedactionSpan[]): RedactionSpan[] {
  const validRampart = rampartSpans.filter((span) => span.start < span.end)
  const validSupplement = supplementSpans.filter((span) => span.start < span.end)
  const keptSupplement = validSupplement.filter(
    (supplement) => !validRampart.some((rampart) => overlaps(rampart, supplement)),
  )

  return [...validRampart, ...keptSupplement]
    .map((span) => ({ ...span, suggestion: suggestedAction(span.category) }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}
