/** Shared revision boundaries for the live preview and OOXML writer. */
export function planTextRevision(from: string, to: string, granular: boolean) {
  if (from === to)
    return {
      prefixLength: from.length,
      removed: '',
      inserted: '',
      suffixLength: 0,
    }
  const middle = granular ? trackedTextMiddle(from, to) : undefined
  return (
    middle ?? { prefixLength: 0, removed: from, inserted: to, suffixLength: 0 }
  )
}

export function trackedTextMiddle(from: string, to: string) {
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
