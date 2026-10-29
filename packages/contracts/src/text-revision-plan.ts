import type { DocumentTextRunWire } from './document-model'
import { normaliseEditText } from './document-edit-shared'

type TextRevisionToken = NonNullable<
  DocumentTextRunWire['textRevisionTokens']
>[number]

export function planTextRevision(
  from: string,
  to: string,
  granular: boolean,
  tokens?: readonly TextRevisionToken[],
  pendingProperties = false,
  textCount = 1,
) {
  const source = from
  from = normaliseEditText(from)
  to = normaliseEditText(to)
  if (from === to)
    return {
      kind: 'noop' as const,
      prefixLength: from.length,
      removed: '',
      inserted: '',
      editableInserted: '',
      suffixLength: 0,
      retained: [],
    }
  const middle =
    granular && !pendingProperties ? trackedTextMiddle(from, to) : undefined
  if (middle)
    return {
      kind: 'granular' as const,
      ...middle,
      editableInserted: middle.inserted,
      retained: [],
    }
  const retained: Array<{ offset: number; text: string }> = []
  const lines = to.split('\n')
  const assigned = Math.min(lines.length, textCount)
  let cursor = 0
  let inserted = ''
  let removed = ''
  let oldCursor = 0
  for (const token of tokens ?? []) {
    removed += source.slice(oldCursor, token.offset) + token.text
    oldCursor = token.offset
  }
  removed += source.slice(oldCursor)
  removed = normaliseEditText(removed)
  for (let textIndex = 0; textIndex <= textCount; textIndex += 1) {
    for (const token of tokens ?? []) {
      if (token.textIndex !== textIndex) continue
      retained.push({ offset: cursor, text: token.text })
      inserted += token.text
    }
    if (textIndex >= assigned) continue
    let piece = lines[textIndex] ?? ''
    if (textIndex === assigned - 1 && lines.length > textCount)
      piece += '\n' + lines.slice(textCount).join('\n')
    else if (textIndex < lines.length - 1) piece += '\n'
    inserted += piece
    cursor += piece.length
  }
  return {
    kind: 'whole-run' as const,
    reason: pendingProperties
      ? ('pending-properties' as const)
      : granular
        ? ('boundary-mismatch' as const)
        : ('ineligible' as const),
    prefixLength: 0,
    removed,
    inserted,
    editableInserted: to,
    suffixLength: 0,
    retained,
  }
}

function trackedTextMiddle(from: string, to: string) {
  const max = Math.min(from.length, to.length)
  let prefixLength = 0
  while (prefixLength < max && from[prefixLength] === to[prefixLength]) {
    prefixLength += 1
  }
  if (pairBoundary(from, prefixLength) || pairBoundary(to, prefixLength)) {
    prefixLength -= 1
  }
  let suffixLength = 0
  const suffixMax = Math.min(from.length, to.length) - prefixLength
  while (
    suffixLength < suffixMax &&
    from[from.length - 1 - suffixLength] === to[to.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }
  if (
    pairBoundary(from, from.length - suffixLength) ||
    pairBoundary(to, to.length - suffixLength)
  ) {
    suffixLength -= 1
  }
  let start = prefixLength
  let oldEnd = from.length - suffixLength
  let newEnd = to.length - suffixLength
  if (from.slice(start, oldEnd) !== '' && to.slice(start, newEnd) !== '') {
    while (start > 0 && !isWordWhitespace(from[start - 1] ?? '')) start -= 1
    while (oldEnd < from.length && !isWordWhitespace(from[oldEnd] ?? '')) {
      oldEnd += 1
    }
    while (newEnd < to.length && !isWordWhitespace(to[newEnd] ?? ''))
      newEnd += 1
  }
  if (from.slice(0, start) !== to.slice(0, start)) return undefined
  if (from.slice(oldEnd) !== to.slice(newEnd)) return undefined
  return {
    prefixLength: start,
    removed: from.slice(start, oldEnd),
    inserted: to.slice(start, newEnd),
    suffixLength: from.length - oldEnd,
  }
}

function pairBoundary(text: string, at: number) {
  if (at <= 0 || at >= text.length) return false
  const lead = text.charCodeAt(at - 1)
  const tail = text.charCodeAt(at)
  return lead >= 0xd800 && lead <= 0xdbff && tail >= 0xdc00 && tail <= 0xdfff
}

function isWordWhitespace(char: string) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
