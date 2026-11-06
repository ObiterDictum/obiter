export type PictureSizeToolbarRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type PictureSizeToolbarPlacement = { left: number; top: number }

const GAP_PX = 8
const MARGIN_PX = 8

function within(value: number, low: number, high: number) {
  return Math.max(low, Math.min(Math.max(low, high), value))
}

export function pictureSizeToolbarPlacement({
  picture,
  panel,
  viewport,
  page,
  gap = GAP_PX,
  margin = MARGIN_PX,
}: {
  picture: PictureSizeToolbarRect
  panel: { width: number; height: number }
  viewport: { width: number; height: number }
  page?: PictureSizeToolbarRect | undefined
  gap?: number
  margin?: number
}): PictureSizeToolbarPlacement {
  const measuredPage = page && page.right > page.left ? page : undefined
  const leftmost = Math.max(margin, measuredPage?.left ?? 0)
  const rightmost = Math.min(
    viewport.width - margin,
    measuredPage ? Math.max(measuredPage.right, leftmost) : viewport.width,
  )
  const highest = Math.max(margin, measuredPage?.top ?? 0)
  const lowest = Math.max(
    highest,
    Math.min(
      viewport.height - margin,
      measuredPage ? Math.max(measuredPage.bottom, highest) : viewport.height,
    ) - panel.height,
  )
  const below = picture.bottom + gap
  const above = picture.top - gap - panel.height
  const fits = (top: number) => top >= highest && top <= lowest
  const roomBelow = lowest + panel.height - picture.bottom
  const roomAbove = picture.top - highest
  const top = fits(below)
    ? below
    : fits(above)
      ? above
      : within(roomBelow >= roomAbove ? below : above, highest, lowest)
  return {
    left: within(picture.left, leftmost, rightmost - panel.width),
    top,
  }
}
