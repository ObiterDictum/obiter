import type { RedactionSpan, SpanCategory } from './types'
import { suggestedAction } from './merge'

const confidenceRank = {
  high: 2,
  medium: 1,
  low: 0,
} satisfies Record<RedactionSpan['confidence'], number>

const patterns: Array<{
  category: SpanCategory
  regex: RegExp
  confidence: RedactionSpan['confidence']
  dateOfBirth?: boolean
}> = [
  {
    category: 'national_insurance',
    regex: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi,
    confidence: 'high',
  },
  {
    category: 'case_reference',
    regex: /\b(?:[A-Z]{1,4}-\d{4}-\d{3,6}|\d{4}\/[A-Z]{2,8}\/\d{1,6})\b/g,
    confidence: 'medium',
  },
  {
    category: 'organisation_name',
    regex:
      /\b[A-Z][A-Za-z]*(?:[ \t]+(?:&[ \t]+)?[A-Z][A-Za-z]*){0,5}[ \t]+(?:LLP|Ltd|plc|Solicitors|Chambers)\b/g,
    confidence: 'low',
  },

  {
    category: 'email',
    regex:
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b(?<!\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|png|jpe?g|gif|bmp|tiff?|webp|mp[34]|mov|exe|dmg|md|rtf|json|xml|html?))/g,
    confidence: 'high',
  },

  {
    category: 'address',
    regex: /\b[A-Z]{1,2}[1-9][A-Z\d]?\s?\d[A-Z]{2}\b/g,
    confidence: 'high',
  },

  {
    category: 'account_number',
    regex: /\bGB\d{2}\s?[A-Z]{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g,
    confidence: 'high',
  },

  {
    category: 'phone',
    regex:
      /(?<!\d)(?:\+44[\s-]?\(?(?:0\)?[\s-]?)?(?:7\d{2,3}[\s-]\d{3}[\s-]?\d{3}|[12]\d[\s-]\d{3,4}[\s-]\d{3,4}|1\d{2,3}[\s-]\d{6}|1\d{2,3}[\s-]\d{3}[\s-]\d{3,4})|0(?:7\d{2,3}[\s-]\d{3}[\s-]?\d{3}|[12]\d[\s-]\d{3,4}[\s-]\d{3,4}|1\d{2,3}[\s-]\d{6}|1\d{2,3}[\s-]\d{3}[\s-]\d{3,4}))(?!\d)/g,
    confidence: 'medium',
  },

  {
    category: 'account_number',
    regex:
      /(?<=\bsort[\s-]?code\b[^\d]{0,15})\d{2}[-\s]?\d{2}[-\s]?\d{2}(?!\d)/gi,
    confidence: 'medium',
  },

  {
    category: 'account_number',
    regex:
      /(?<=\b(?:account\s*(?:no\.?|number)|a\/c)\b[^\d]{0,15})\d{8}(?!\d)/gi,
    confidence: 'medium',
  },

  {
    category: 'date',
    regex:
      /(?<=(?:\bdate\s+of\s+birth\b|\bd\.o\.b\.?|\bdob\b|\bborn\s+on\b|\bborn\b)[^\d]{0,20})(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/gi,
    confidence: 'high',
    dateOfBirth: true,
  },
]

function overlaps(left: RedactionSpan, right: RedactionSpan) {
  return left.start < right.end && right.start < left.end
}

function dedupeOverlaps(spans: RedactionSpan[]): RedactionSpan[] {
  const resolved: RedactionSpan[] = []
  for (const span of spans) {
    const conflictIndex = resolved.findIndex((kept) => overlaps(kept, span))
    if (conflictIndex === -1) {
      resolved.push(span)
      continue
    }
    const conflict = resolved[conflictIndex]!
    const spanWins =
      confidenceRank[span.confidence] > confidenceRank[conflict.confidence] ||
      (confidenceRank[span.confidence] ===
        confidenceRank[conflict.confidence] &&
        span.end - span.start > conflict.end - conflict.start)
    if (spanWins) resolved[conflictIndex] = span
  }
  return resolved
}

export function supplementSpans(text: string): RedactionSpan[] {
  if (text.length === 0) return []

  const spans = patterns.flatMap(
    ({ category, regex, confidence, dateOfBirth }) =>
      [...text.matchAll(regex)].map((match, index) => {
        const start = match.index
        const matchedText = match[0]
        return {
          id: `span_uk_${category}_${start}_${index}`,
          start,
          end: start + matchedText.length,
          text: matchedText,
          category,
          source: 'uk_supplement' as const,
          confidence,
          suggestion: suggestedAction(category, dateOfBirth === true),
        }
      }),
  )

  return dedupeOverlaps(spans).sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
}
