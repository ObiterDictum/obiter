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

export function suggestedAction(
  category: SpanCategory,
  isDateOfBirth = false,
): SpanSuggestion {
  if (category === 'date') return isDateOfBirth ? 'redact' : 'keep'
  return redactByDefault.has(category) ? 'redact' : 'keep'
}

function overlaps(left: RedactionSpan, right: RedactionSpan) {
  return left.start < right.end && right.start < left.end
}

function unionText(left: RedactionSpan, right: RedactionSpan) {
  const [first, second] =
    left.start <= right.start ? [left, right] : [right, left]
  return first.text + second.text.slice(Math.max(0, first.end - second.start))
}

function longerSpan(left: RedactionSpan, right: RedactionSpan) {
  const leftLength = left.end - left.start
  const rightLength = right.end - right.start
  if (rightLength !== leftLength) {
    return rightLength > leftLength ? right : left
  }
  if (left.source === 'uk_supplement' && right.source !== 'uk_supplement') {
    return right
  }
  return left
}

function unionSpans(left: RedactionSpan, right: RedactionSpan): RedactionSpan {
  const base = longerSpan(left, right)
  const suggestion =
    left.suggestion === 'redact' || right.suggestion === 'redact'
      ? 'redact'
      : (base.suggestion ?? suggestedAction(base.category))
  return {
    ...base,
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
    text: unionText(left, right),
    suggestion,
  }
}

export function mergeSpans(
  rampartSpans: RedactionSpan[],
  supplementSpans: RedactionSpan[],
): RedactionSpan[] {
  const validRampart = rampartSpans.filter((span) => span.start < span.end)
  const validSupplement = supplementSpans.filter(
    (span) => span.start < span.end,
  )
  const merged = [...validRampart]
  for (const supplement of validSupplement) {
    const hits = merged.filter((span) => overlaps(span, supplement))
    if (hits.length === 0) {
      merged.push(supplement)
      continue
    }
    const union = hits.reduce(unionSpans, supplement)
    for (const hit of hits) {
      const index = merged.indexOf(hit)
      if (index >= 0) merged.splice(index, 1)
    }
    merged.push(union)
  }

  return merged
    .map((span) => ({
      ...span,
      suggestion: span.suggestion ?? suggestedAction(span.category),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}
