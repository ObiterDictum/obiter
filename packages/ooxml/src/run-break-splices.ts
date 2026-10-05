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
 * boundary (the next run's start, or the paragraph end), not to this run.
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
      replacement.start < runRange.end
    ) {
      return true
    }
  }
  return false
}
