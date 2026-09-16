import type { DocumentTextRunWire } from '@obiter/contracts'

/**
 * The pure run-list range primitives the paragraph edit operations compose:
 * replacing a UTF-16 range inside a run list, splitting one at an offset, and
 * removing a key from a run map. They hold no editor state, so they are the
 * part of the word-edit module that can be reasoned about (and tested) without
 * a document.
 */

export function replaceRunRange(
  runs: DocumentTextRunWire[],
  from: number,
  to: number,
  insert: string,
): DocumentTextRunWire[] {
  if (runs.length === 0) {
    return [{ id: 'empty', text: insert, preservedXmlFragments: [] }]
  }
  let cursor = 0
  let written = false
  const next: DocumentTextRunWire[] = []
  for (const run of runs) {
    const start = cursor
    const end = cursor + run.text.length
    cursor = end
    if (end < from || start > to) {
      next.push(run)
      continue
    }
    const localFrom = Math.max(0, from - start)
    const localTo = Math.min(run.text.length, Math.max(0, to - start))
    const prefix = run.text.slice(0, localFrom)
    const suffix = run.text.slice(localTo)
    const piece = written ? '' : insert
    written = true
    next.push({ ...run, text: prefix + piece + suffix })
  }
  if (!written) {
    const last = next[next.length - 1]
    if (last) next[next.length - 1] = { ...last, text: last.text + insert }
  }
  return next
}

export function splitRuns(
  runs: DocumentTextRunWire[],
  offset: number,
  newId: string,
): { left: DocumentTextRunWire[]; right: DocumentTextRunWire[] } {
  let cursor = 0
  const left: DocumentTextRunWire[] = []
  const right: DocumentTextRunWire[] = []
  let tail = 0
  for (const run of runs) {
    const start = cursor
    const end = cursor + run.text.length
    cursor = end
    if (end <= offset) left.push({ ...run })
    else if (start >= offset) {
      right.push({ ...run, id: `${newId}-r${tail}` })
      tail += 1
    } else {
      const at = offset - start
      if (at > 0) left.push({ ...run, text: run.text.slice(0, at) })
      right.push({
        ...run,
        id: `${newId}-r${tail}`,
        text: run.text.slice(at),
      })
      tail += 1
    }
  }
  if (left.length === 0) {
    left.push({ id: `${newId}-left`, text: '', preservedXmlFragments: [] })
  }
  if (right.length === 0) {
    right.push({ id: `${newId}-r0`, text: '', preservedXmlFragments: [] })
  }
  return { left, right }
}

export function omitKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
