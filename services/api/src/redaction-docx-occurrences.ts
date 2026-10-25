import { affectsOutput, type Decisions, type RedactionSpan } from '@obiter/redaction-policy'

/** Accepted identities apply package-wide, except an explicitly kept occurrence. */
export function acceptedDocxOccurrences(text: string, spans: RedactionSpan[], decisions: Decisions) {
  const expanded = [...spans]
  const resolved = { ...decisions }
  const accepted = spans.filter(span => affectsOutput(decisions[span.id]))
  const kept = spans.filter(span => ['reject', 'override_keep'].includes(decisions[span.id]?.decision ?? ''))
  const occupied = new Set(accepted.map(span => `${span.start}:${span.end}`))
  let additionalBurns = 0
  for (const span of accepted) {
    if (!span.text) continue
    const escaped = span.text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const before = /[\p{L}\p{N}]/u.test(span.text[0] ?? '') ? '(?<![\\p{L}\\p{N}])' : ''
    const after = /[\p{L}\p{N}]/u.test(span.text.at(-1) ?? '') ? '(?![\\p{L}\\p{N}])' : ''
    for (const match of text.matchAll(new RegExp(before + escaped + after, 'gu'))) {
      const start = match.index
      const end = start + span.text.length
      const key = `${start}:${end}`
      if (occupied.has(key) || kept.some(other => other.text === span.text && other.start === start && other.end === end)) continue
      const id = `additional_${span.id}_${start}`
      expanded.push({...span, id, start, end})
      resolved[id] = decisions[span.id]
      occupied.add(key)
      additionalBurns++
    }
  }
  return { spans: expanded, decisions: resolved, additionalBurns }
}
