import type { DocumentComparisonSegment } from '@obiter/contracts'
import { DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT } from '@obiter/contracts'

const WORD_DIFF_TOKEN_LIMIT = 500

export function wordDiff(
  baseText: string,
  targetText: string,
): DocumentComparisonSegment[] {
  const baseTokens = tokenise(baseText)
  const targetTokens = tokenise(targetText)
  let start = 0
  while (
    start < baseTokens.length &&
    start < targetTokens.length &&
    baseTokens[start] === targetTokens[start]
  ) {
    start += 1
  }
  let baseEnd = baseTokens.length
  let targetEnd = targetTokens.length
  while (
    baseEnd > start &&
    targetEnd > start &&
    baseTokens[baseEnd - 1] === targetTokens[targetEnd - 1]
  ) {
    baseEnd -= 1
    targetEnd -= 1
  }

  const coarse = () => {
    const segments: DocumentComparisonSegment[] = []
    const sameHead = joinTokens(baseTokens.slice(0, start))
    if (sameHead) segments.push({ kind: 'same', text: sameHead })
    const removed = joinTokens(baseTokens.slice(start, baseEnd))
    if (removed) segments.push({ kind: 'removed', text: removed })
    const added = joinTokens(targetTokens.slice(start, targetEnd))
    if (added) segments.push({ kind: 'added', text: added })
    const sameTail = joinTokens(baseTokens.slice(baseEnd))
    if (sameTail) segments.push({ kind: 'same', text: sameTail })
    return segments
  }

  if (
    baseEnd - start > WORD_DIFF_TOKEN_LIMIT ||
    targetEnd - start > WORD_DIFF_TOKEN_LIMIT
  ) {
    return coarse()
  }

  const segments: DocumentComparisonSegment[] = []
  const sameHead = joinTokens(baseTokens.slice(0, start))
  if (sameHead) segments.push({ kind: 'same', text: sameHead })
  for (const segment of lcsDiff(
    baseTokens.slice(start, baseEnd),
    targetTokens.slice(start, targetEnd),
  )) {
    segments.push(segment)
  }
  const sameTail = joinTokens(baseTokens.slice(baseEnd))
  if (sameTail) segments.push({ kind: 'same', text: sameTail })
  const merged = mergeSegments(segments)
  return merged.length <= DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT
    ? merged
    : coarse()
}

export function tokenise(text: string) {
  return text.match(/\S+|\s+/g) ?? []
}

function joinTokens(tokens: string[]) {
  return tokens.join('')
}

function lcsDiff(base: string[], target: string[]) {
  const rows = base.length
  const columns = target.length
  const table = new Uint32Array((rows + 1) * (columns + 1))
  const at = (row: number, column: number) => row * (columns + 1) + column
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        base[row] === target[column]
          ? table[at(row + 1, column + 1)] + 1
          : Math.max(table[at(row + 1, column)], table[at(row, column + 1)])
    }
  }
  const segments: DocumentComparisonSegment[] = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (base[row] === target[column]) {
      segments.push({ kind: 'same', text: joinTokens([base[row]]) })
      row += 1
      column += 1
    } else if (table[at(row + 1, column)] >= table[at(row, column + 1)]) {
      segments.push({ kind: 'removed', text: joinTokens([base[row]]) })
      row += 1
    } else {
      segments.push({ kind: 'added', text: joinTokens([target[column]]) })
      column += 1
    }
  }
  while (row < rows) {
    segments.push({ kind: 'removed', text: joinTokens([base[row]]) })
    row += 1
  }
  while (column < columns) {
    segments.push({ kind: 'added', text: joinTokens([target[column]]) })
    column += 1
  }
  return segments
}

function mergeSegments(segments: DocumentComparisonSegment[]) {
  const merged: DocumentComparisonSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && last.kind === segment.kind) {
      merged[merged.length - 1] = {
        kind: last.kind,
        text: last.text + segment.text,
      }
    } else {
      merged.push(segment)
    }
  }
  return merged
}
