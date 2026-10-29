import type { XmlElementRange } from './model'
import type { XmlOverlay } from './parts/overlay'

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
