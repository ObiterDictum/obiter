/**
 * How a tracked change paints on the paper. The sheet is a fixed white page in
 * both themes — the surrounding chrome is what changes colour — so these marks
 * cannot be theme tokens: a theme's "danger" and "success" lighten in dark mode
 * and would wash out on white. The page and the comparison redline both mark a
 * change, so the classes live here rather than beside either of them.
 */
export const TRACKED_INSERT_MARK =
  'underline decoration-[#3d7a52] underline-offset-4'
export const TRACKED_DELETE_MARK =
  'text-[#9a4f3c] line-through decoration-[#9a4f3c]'

/**
 * The six reviewer hues, restated for the paper. `--obiter-reviewer-N` is a
 * theme token, and the dark theme lightens it to about 1.7:1 on the fixed
 * white sheet — legible as a mark in a panel, unreadable as text on paper. The
 * paper keeps the light theme's dark hues in both themes, one per slot, so a
 * reviewer stays the same colour across a theme change and every hue still
 * clears 3:1 on `#fffdf8` (the initials in the review panel remain the
 * colour-independent cue).
 */
export const PAPER_REVIEWER_MARKS = [
  'text-[hsl(214_70%_34%)]',
  'text-[hsl(150_55%_26%)]',
  'text-[hsl(268_55%_40%)]',
  'text-[hsl(28_70%_31%)]',
  'text-[hsl(186_70%_24%)]',
  'text-[hsl(330_55%_37%)]',
] as const
