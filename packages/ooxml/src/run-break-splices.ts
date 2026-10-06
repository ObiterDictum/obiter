import type { XmlElementRange } from './model'
import type { XmlOverlay } from './parts/overlay'

/**
 * Whether a page-break splice or a materialised break replacement already
 * claims part of the run. A paragraph-keyed `...:page-break:<offset>`
 * zero-width splice and a run-keyed `...:page-break-run` whole-run replacement
 * both count: either means the run's structure lives in the overlay, so a
 * run-keyed writer cannot rewrite inside it without styling only the reopened
 * tail's stale parse-time property snapshot (or overlapping the splice point,
 * which the overlay serialiser rejects as a plain error).
 *
 * A zero-width insertion exactly at the run's end belongs to the following
 * boundary (the next run's start, or the paragraph end), not to this run. A
 * zero-width insertion exactly at the run's start likewise belongs to the
 * preceding boundary: `locateOffset` places the standalone break run *before*
 * the run tag, so the run is neither closed nor reopened and a run-keyed write
 * serialises alongside it. A replacement that starts at the run's start but is
 * not zero-width is the run-keyed whole-run rebuild and still counts.
 */
export function hasPendingBreakSplice(
  overlay: XmlOverlay,
  runRange: XmlElementRange,
) {
  for (const [key, replacement] of overlay.replacements) {
    if (!key.includes('page-break')) continue
    if (
      replacement.start >= runRange.start &&
      replacement.end <= runRange.end &&
      replacement.start < runRange.end &&
      // Only a zero-width splice at the start is the before-tag boundary
      // break; a non-zero-width replacement from the start is the whole-run
      // rebuild, which repaints every character and must keep failing closed.
      !(
        replacement.start === runRange.start &&
        replacement.end === runRange.start
      )
    ) {
      return true
    }
  }
  return false
}
