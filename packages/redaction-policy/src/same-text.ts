import type { Decisions, RedactionSpan } from './types'
import type { SpanCategory, SpanDecision } from '@obiter/contracts'

/**
 * The text one occurrence of a repeated name is compared on. Case and whitespace
 * differ between occurrences of the same name ("Priya", "priya ", "Priya\n"), so
 * comparing raw span text would miss exactly the leak this guards: a name kept
 * in one place and redacted in another.
 */
export function sameTextKey(text: string) {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** Whether a decision removes the text from the copy that leaves the firm. */
export function decisionRemovesText(decision: SpanDecision) {
  return decision !== 'reject' && decision !== 'override_keep'
}

export function sameTextOccurrences(spans: RedactionSpan[], text: string) {
  const key = sameTextKey(text)
  return spans.filter((span) => sameTextKey(span.text) === key)
}

export interface MixedTextGroup {
  key: string
  /** The text as it appears in the document; every occurrence reads the same. */
  text: string
  category: SpanCategory
  /** Occurrences whose decision removes the text from the output. */
  removed: string[]
  /** Occurrences whose decision keeps the text in the output. */
  kept: string[]
}

/**
 * Same text, contradictory decisions. The output would redact one occurrence
 * and carry the other, so the reviewer's decision leaks the very text they
 * decided to remove. Judged on removal, not on the exact decision word: a
 * redacted occurrence and a pseudonymised one both remove the text.
 */
export function mixedTextGroups(
  spans: RedactionSpan[],
  decisions: Decisions,
): MixedTextGroup[] {
  const groups = new Map<string, MixedTextGroup>()
  for (const span of spans) {
    const record = decisions[span.id]
    if (!record) continue
    const key = sameTextKey(span.text)
    const group = groups.get(key) ?? {
      key,
      text: span.text,
      category: span.category,
      removed: [],
      kept: [],
    }
    const bucket = decisionRemovesText(record.decision)
      ? group.removed
      : group.kept
    bucket.push(span.id)
    groups.set(key, group)
  }
  return [...groups.values()].filter(
    (group) => group.removed.length > 0 && group.kept.length > 0,
  )
}
