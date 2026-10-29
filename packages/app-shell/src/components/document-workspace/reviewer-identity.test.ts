import { describe, expect, it } from 'bun:test'
import { reviewerStyle } from './reviewer-identity'

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
