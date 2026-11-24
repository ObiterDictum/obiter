import { describe, expect, it } from 'bun:test'
import { splitFit, splitPageZoom } from '@obiter/app-shell'
import {
  REVIEW_PAGE_ZOOM_MAX,
  REVIEW_PAGE_ZOOM_MIN,
  stepReviewZoom,
  zoomLevelForPagePercent,
} from './review-zoom'

const pane = (paneWidth: number) => ({
  paneWidth,
  scrollbarWidth: 0,
  paperWidth: 794,
})

describe('review zoom', () => {
  it('fits an A4 Word page inside the review pane at the default level', () => {
    expect(splitPageZoom([pane(549)], 100)).toBe(61)
    expect(splitPageZoom([pane(549)], 100)).toBeLessThanOrEqual(
      Math.floor(pane(549).paneWidth),
    )
    expect(794 * splitFit([pane(549)])).toBeLessThanOrEqual(549 - 64)
  })

  it('keeps fitting to width when only the window changes', () => {
    expect(splitPageZoom([pane(649)], 100)).toBe(73)
    expect(splitPageZoom([pane(1140)], 100)).toBe(100)
  })

  it('resolves the level that renders the page at its own size', () => {
    for (const width of [549, 649, 700, 900]) {
      const fit = splitFit([pane(width)])
      const level = zoomLevelForPagePercent(fit, 100)
      expect(splitPageZoom([pane(width)], level)).toBe(100)
    }
  })

  it('steps one scale notch at a time', () => {
    expect(stepReviewZoom(100, -10)).toBe(90)
    expect(stepReviewZoom(100, 10)).toBe(110)
    expect(stepReviewZoom(1, -10)).toBe(1)
    expect(REVIEW_PAGE_ZOOM_MIN).toBeLessThan(100)
    expect(REVIEW_PAGE_ZOOM_MAX).toBeGreaterThan(100)
  })

  it('falls back to the requested size when the pane has no measured width', () => {
    expect(zoomLevelForPagePercent(0, 100)).toBe(100)
  })
})
