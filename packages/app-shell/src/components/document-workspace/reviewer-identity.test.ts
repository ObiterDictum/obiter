import { describe, expect, it } from 'bun:test'
import { reviewerStyle } from './reviewer-identity'

/**
 * A tracked change paints in the reviewer's hue. On the fixed white sheet that
 * hue is the paper form of the palette, not the theme token: the dark theme
 * lightens the token until the mark is unreadable on paper, so a paper mark
 * must never be the theme's reviewer class.
 */
describe('reviewer paper marks', () => {
  it('gives every slot a fixed paper hue that is not the theme token', () => {
    const paperBySlot = new Map<number, string>()
    for (let index = 0; index < 200; index += 1) {
      const style = reviewerStyle(`author ${String(index)}`)
      const known = paperBySlot.get(style.slot)
      if (known === undefined) paperBySlot.set(style.slot, style.paperText)
      else expect(style.paperText).toBe(known)
      expect(style.paperText).not.toBe(style.text)
      expect(style.paperText).not.toContain('text-reviewer-')
      expect(style.paperText).toMatch(/^text-\[hsl\(/u)
    }
    expect(paperBySlot.size).toBe(6)
    expect(new Set(paperBySlot.values()).size).toBe(6)
  })
})
