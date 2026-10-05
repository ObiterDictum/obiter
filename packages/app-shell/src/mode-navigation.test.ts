import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { wheelScrollDelta } from './mode-navigation'

function wheel(init: WheelEventInit): WheelEvent {
  return new WheelEvent('wheel', init)
}

describe('wheelScrollDelta', () => {
  it('translates a pixel vertical wheel into horizontal scroll', () => {
    expect(wheelScrollDelta(wheel({ deltaY: 120 }), 300)).toBe(120)
  })

  it('scales a line-mode wheel so a mouse wheel covers a sensible distance', () => {
    expect(wheelScrollDelta(wheel({ deltaY: 3, deltaMode: 1 }), 300)).toBe(48)
  })

  it('scales a page-mode wheel by the visible width', () => {
    expect(wheelScrollDelta(wheel({ deltaY: 1, deltaMode: 2 }), 300)).toBe(300)
  })

  it('ignores ctrl+wheel, which is browser zoom', () => {
    expect(
      wheelScrollDelta(wheel({ deltaY: 120, ctrlKey: true }), 300),
    ).toBeNull()
  })

  it('leaves a horizontal trackpad gesture to the browser', () => {
    expect(wheelScrollDelta(wheel({ deltaX: 90, deltaY: 4 }), 300)).toBeNull()
    expect(wheelScrollDelta(wheel({ deltaX: 90, deltaY: 90 }), 300)).toBeNull()
  })

  it('ignores a wheel with no vertical component', () => {
    expect(wheelScrollDelta(wheel({}), 300)).toBeNull()
  })
})
