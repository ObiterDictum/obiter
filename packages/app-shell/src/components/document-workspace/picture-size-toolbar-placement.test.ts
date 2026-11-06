import { describe, expect, it } from 'bun:test'
import {
  pictureSizeToolbarPlacement,
  type PictureSizeToolbarRect,
} from './picture-size-toolbar-placement'

const VIEWPORT = { width: 1440, height: 900 }

const PAGE: PictureSizeToolbarRect = {
  left: 451,
  top: 210,
  right: 1266,
  bottom: 962,
}

const PANEL = { width: 260, height: 64 }

const PICTURE: PictureSizeToolbarRect = {
  left: 572,
  top: 300,
  right: 900,
  bottom: 520,
}

function placed(
  picture: PictureSizeToolbarRect,
  {
    viewport = VIEWPORT,
    page = PAGE,
    panel = PANEL,
  }: {
    viewport?: { width: number; height: number }
    page?: PictureSizeToolbarRect
    panel?: { width: number; height: number }
  } = {},
) {
  return pictureSizeToolbarPlacement({ picture, panel, viewport, page })
}

function overlaps(
  at: { left: number; top: number },
  picture: PictureSizeToolbarRect,
) {
  return (
    at.top < picture.bottom &&
    at.top + PANEL.height > picture.top &&
    at.left < picture.right &&
    at.left + PANEL.width > picture.left
  )
}

describe('placing the picture size control', () => {
  it('sits below the picture, left-aligned with it', () => {
    expect(placed(PICTURE)).toEqual({ left: PICTURE.left, top: 528 })
  })

  it('leaves a gap below the picture so the control clears it', () => {
    expect(placed(PICTURE).top - PICTURE.bottom).toBe(8)
  })

  it('moves above the picture when there is no room below it', () => {
    const low = { ...PICTURE, top: 700, bottom: 860 }
    expect(placed(low)).toEqual({ left: low.left, top: 628 })
  })

  it('moves above a picture that sits at the bottom of its page', () => {
    const page = { left: 451, top: 210, right: 1266, bottom: 700 }
    const picture = { left: 572, top: 560, right: 900, bottom: 690 }
    const at = placed(picture, { page })
    expect(at).toEqual({ left: picture.left, top: 488 })
    expect(at.top + PANEL.height).toBeLessThanOrEqual(page.bottom)
    expect(overlaps(at, picture)).toBe(false)
  })

  it('never overlaps the picture or the handles around it', () => {
    const cases = [
      PICTURE,
      { ...PICTURE, top: 700, bottom: 860 },
      { ...PICTURE, top: 210, bottom: 420 },
      { ...PICTURE, top: 500, bottom: 700 },
    ]
    for (const picture of cases) {
      expect(overlaps(placed(picture), picture)).toBe(false)
    }
  })

  it('keeps the control inside the page width', () => {
    const edge = { ...PICTURE, left: 1200, right: 1250 }
    const at = placed(edge)
    expect(at.left).toBe(PAGE.right - PANEL.width)
    expect(at.left + PANEL.width).toBeLessThanOrEqual(PAGE.right)
  })

  it('fits inside a 390 px viewport with no overflow', () => {
    const viewport = { width: 390, height: 800 }
    const page = { left: 20, top: 40, right: 370, bottom: 780 }
    const picture = { left: 120, top: 100, right: 300, bottom: 300 }
    const panel = { width: 280, height: 64 }
    const at = placed(picture, { viewport, page, panel })
    expect(at.left).toBeGreaterThanOrEqual(page.left)
    expect(at.left + panel.width).toBeLessThanOrEqual(page.right)
    expect(at.top + panel.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('stays inside the viewport when neither side of the picture has room', () => {
    const viewport = { width: 1024, height: 400 }
    const picture = { left: 100, top: 20, right: 800, bottom: 380 }
    const at = placed(picture, { viewport })
    expect(at.top).toBeGreaterThanOrEqual(8)
    expect(at.top + PANEL.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('falls back to the viewport when the page cannot be measured', () => {
    const page = { left: 0, top: 0, right: 0, bottom: 0 }
    expect(placed(PICTURE, { page })).toEqual({
      left: PICTURE.left,
      top: 528,
    })
  })
})
