import { twipToPx } from './document-page-units'

export const DEFAULT_TAB_STOP_TWIPS = 720
export const DEFAULT_TAB_STOP_PX = twipToPx(DEFAULT_TAB_STOP_TWIPS)

export function tabAdvancePx(
  columnPx: number,
  stopsPx: readonly number[],
  defaultStopPx: number,
) {
  const next = stopsPx.filter((pos) => pos > columnPx).sort((a, b) => a - b)[0]
  if (next !== undefined) return next - columnPx
  const stop = defaultStopPx > 0 ? defaultStopPx : DEFAULT_TAB_STOP_PX
  return stop - (columnPx % stop)
}
