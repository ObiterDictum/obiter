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
