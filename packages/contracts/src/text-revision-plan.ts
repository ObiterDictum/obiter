import type { DocumentTextRunWire } from './document-model'

/** Shared revision boundaries for the live preview and OOXML writer. */
type TextRevisionToken = NonNullable<
  DocumentTextRunWire['textRevisionTokens']
>[number]

export function planTextRevision(
  from: string,
  to: string,
  granular: boolean,
  tokens?: readonly TextRevisionToken[],
  pendingProperties = false,
) {
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
  const lines = to.split(/\r\n|\r|\n/u)
  const textCount = tokens?.filter((token) => token.kind === 'text').length ?? 1
  const assigned = Math.min(lines.length, textCount)
  let textIndex = 0
  let cursor = 0
  let inserted = ''
  for (const token of tokens ?? [{ kind: 'text', text: from }]) {
    if (token.kind === 'break') continue
    if (token.kind === 'retained') {
      retained.push({ offset: cursor, text: token.text })
      inserted += token.text
      continue
    }
    let piece = ''
    if (textIndex < assigned) {
      piece = lines[textIndex] ?? ''
      if (textIndex === assigned - 1 && lines.length > textCount)
        piece += '\n' + lines.slice(textCount).join('\n')
      else if (textIndex < lines.length - 1) piece += '\n'
    }
    textIndex += 1
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
    removed: tokens?.map((token) => token.text).join('') ?? from,
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
    // Both expansions walk the identical shared head and tail, so the kept
    // edges stay equal on both sides by construction; the check below proves
    // it rather than assuming it.
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

/** XML whitespace: the four characters Word's own tokenisation treats as a
 * break. Non-breaking spaces stay inside a token so a struck quantity keeps
 * its unit. */
function isWordWhitespace(char: string) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
