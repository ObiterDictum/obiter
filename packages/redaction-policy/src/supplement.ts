import type { RedactionSpan, SpanCategory } from './types'
import { suggestedAction } from './merge'

// Detection here is deterministic UK patterns only. These patterns are a
// high-precision stopgap: precision is weighted over recall because a false
// positive erodes reviewer trust more than a miss. Every pattern is anchored
// or context-gated so ordinary legal prose (neutral citations, dates, case
// numbers, damages figures) does not trigger it.
//
// Ambiguous bare-digit identifiers are deliberately gated on nearby context
// words: a bare 6- or 8-digit run is too ambiguous in legal text (sort codes,
// dates, page references, money figures) to match without a cue. Distinctive,
// well-specified formats (email, postcode, IBAN, phone with a UK trunk or
// country prefix) are safe to match bare and carry higher confidence.
const patterns: Array<{ category: SpanCategory; regex: RegExp; confidence: RedactionSpan['confidence'] }> = [
  // --- Existing UK legal-specific patterns ---
  { category: 'national_insurance', regex: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, confidence: 'high' },
  { category: 'case_reference', regex: /\b(?:[A-Z]{1,4}-\d{4}-\d{3,6}|\d{4}\/[A-Z]{2,8}\/\d{1,6})\b/g, confidence: 'medium' },
  { category: 'organisation_name', regex: /\b[A-Z][A-Za-z]*(?:\s+(?:&\s+)?[A-Z][A-Za-z]*){0,5}\s+(?:LLP|Ltd|plc|Solicitors|Chambers)\b/g, confidence: 'low' },

  // --- Standard contact identifiers (well-specified, safe to match bare) ---
  // Standard email address. Anchored on word boundaries; the local-part and
  // domain character classes plus the TLD requirement exclude prose.
  { category: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 'high' },

  // UK postcode. The outward-code (letters + digit + optional alnum) / inward
  // code (digit + two letters) shape is specific enough that dates, citations
  // and case numbers do not match.
  { category: 'address', regex: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, confidence: 'high' },

  // GB IBAN (22 characters): country code + check digits + 4-letter bank code
  // + 14 digits. Optional single spaces between the standard 4-character groups
  // are tolerated; matched as one span.
  { category: 'account_number', regex: /\bGB\d{2}\s?[A-Z]{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g, confidence: 'high' },

  // UK phone numbers. International (+44, with or without a (0) trunk prefix)
  // and national (trunk 0) forms, mobile and geographic, with common
  // space/hyphen grouping. Bounded by non-digits on both sides so it cannot
  // latch onto a date, citation number or damages figure. Medium confidence:
  // the format is real but unverified against a live subscriber database.
  {
    category: 'phone',
    regex: /(?<!\d)(?:\+44[\s-]?\(?(?:0\)?[\s-]?)?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4}|0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})(?!\d)/g,
    confidence: 'medium',
  },

  // --- Context-gated bank details (ambiguous when bare) ---
  // UK sort code (xx-xx-xx or xx xx xx or xxxxxx) ONLY when preceded within a
  // short window by "sort code" / "sort-code" / "sortcode". The lookbehind
  // keeps the span on the number itself.
  {
    category: 'account_number',
    regex: /(?<=\bsort[\s-]?code\b[^\d]{0,15})\d{2}[-\s]?\d{2}[-\s]?\d{2}(?!\d)/gi,
    confidence: 'medium',
  },

  // 8-digit UK account number ONLY when preceded within a short window by an
  // explicit cue ("account number", "account no", "a/c"). Bare 8-digit runs
  // are too ambiguous in legal text to match without a cue.
  {
    category: 'account_number',
    regex: /(?<=\b(?:account\s*(?:no\.?|number)|a\/c)[^\d]{0,15})\d{8}(?!\d)/gi,
    confidence: 'medium',
  },
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
