import type { RedactionSpan, SpanCategory } from './types'
import { suggestedAction } from './merge'

const patterns: Array<{ category: SpanCategory; regex: RegExp; confidence: RedactionSpan['confidence'] }> = [
  { category: 'national_insurance', regex: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, confidence: 'high' },
  { category: 'case_reference', regex: /\b(?:[A-Z]{1,4}-\d{4}-\d{3,6}|\d{4}\/[A-Z]{2,8}\/\d{1,6})\b/g, confidence: 'medium' },
  { category: 'organisation_name', regex: /\b[A-Z][A-Za-z]*(?:\s+(?:&\s+)?[A-Z][A-Za-z]*){0,5}\s+(?:LLP|Ltd|plc|Solicitors|Chambers)\b/g, confidence: 'low' },
]

export function supplementSpans(text: string): RedactionSpan[] {
  if (text.length === 0) return []

  return patterns.flatMap(({ category, regex, confidence }) =>
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
        suggestion: suggestedAction(category),
      }
    }),
  ).sort((left, right) => left.start - right.start || left.end - right.end)
}
