import type { DocumentTextRunWire } from '@obiter/contracts'

/**
 * Whether every fragment of a run is a run-properties element. A run's preserved
 * fragments hold its `w:rPr` and any direct structural children (drawings,
 * breaks, fields, bookmarks); only the properties can be restated by a range
 * emphasis over appended text.
 */
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

/**
 * Whether moving `moving` onto `head` can be reproduced on save. The save plan
 * restates each appended run's properties as a range emphasis over its slice,
 * which cannot carry a character style, and the appended text would otherwise
 * inherit the head's last run character style. When the head paragraph has no
 * run of its own the appended runs become an insert payload, which does carry a
 * character style, so only their fragments need to be representable.
 */
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
