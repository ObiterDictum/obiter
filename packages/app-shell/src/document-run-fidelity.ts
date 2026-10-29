import type { DocumentTextRunWire } from '@obiter/contracts'

function isRunPropertyFragment(fragment: string): boolean {
  const prefix = fragment.match(/^<\s*([A-Za-z_][\w.-]*):/u)?.[1] ?? 'w'
  return new RegExp(`^\\s*<${prefix}:rPr\\b`, 'i').test(fragment)
}

function runsHaveRepresentableFragments(
  runs: readonly DocumentTextRunWire[],
): boolean {
  return runs.every((run) =>
    run.preservedXmlFragments.every(isRunPropertyFragment),
  )
}

export function canJoinParagraphRuns(
  head: readonly DocumentTextRunWire[],
  moving: readonly DocumentTextRunWire[],
): boolean {
  if (!runsHaveRepresentableFragments(moving)) return false
  const last = head[head.length - 1]
  if (!last) return true
  return (
    last.styleId === undefined &&
    moving.every((run) => run.styleId === undefined)
  )
}
