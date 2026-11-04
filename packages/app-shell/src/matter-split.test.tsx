import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { splitPageZoom } from './matter-split-scale'

describe('splitPageZoom', () => {
  it('scales both sides to the narrower pane, so an even split shares one scale', () => {
    const even = splitPageZoom(1000, 50, 100)
    expect(even).toBe(58)
    expect(splitPageZoom(1000, 100 - 50, 100)).toBe(even)
  })

  it('follows the narrower side when the split is uneven', () => {
    expect(splitPageZoom(1000, 30, 100)).toBe(35)
    expect(splitPageZoom(1000, 70, 100)).toBe(35)
  })

  it('stops at actual size and keeps the paper inside the pane', () => {
    expect(splitPageZoom(2400, 50, 100)).toBe(100)
    expect(splitPageZoom(400, 50, 100)).toBe(35)
  })

  it('applies the shared zoom control to the fitted scale', () => {
    expect(splitPageZoom(1000, 50, 120)).toBe(70)
    expect(splitPageZoom(1000, 50, 75)).toBe(44)
  })

  it('leaves the zoom alone before the pane has been measured', () => {
    expect(splitPageZoom(null, 50, 100)).toBe(100)
  })
})
