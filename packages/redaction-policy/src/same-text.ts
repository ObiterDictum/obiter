import type { Decisions, RedactionSpan } from './types'
import type { SpanCategory, SpanDecision } from '@obiter/contracts'

export function sameTextKey(text: string) {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function decisionRemovesText(decision: SpanDecision) {
  return decision !== 'reject' && decision !== 'override_keep'
}

export function sameTextOccurrences(spans: RedactionSpan[], text: string) {
  const key = sameTextKey(text)
  return spans.filter((span) => sameTextKey(span.text) === key)
}

export interface MixedTextGroup {
  key: string
  text: string
  category: SpanCategory
  removed: string[]
  kept: string[]
}

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
