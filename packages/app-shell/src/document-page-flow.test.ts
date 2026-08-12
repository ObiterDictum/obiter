import { describe, expect, it } from 'vitest'
import { countLines, takeLine, wrapLines } from './document-page-flow'

describe('takeLine', () => {
  it('wraps on spaces using measured glyph widths, not a fixed character grid', () => {
    const text = 'alpha bravo charlie delta echo'
    const taken = takeLine(text, 0, 16, 80)
    expect(taken).toBeGreaterThan(0)
    expect(text.slice(0, taken).endsWith(' ')).toBe(true)
    expect(taken).toBeLessThan(text.length)
  })

  it('treats a newline as a hard break', () => {
    expect(takeLine('Hello\nWorld', 0, 16, 400)).toBe(6)
  })

  it('keeps an overflowing first word on the line, as Word does', () => {
    const word = 'Supercalifragilistic'
    const taken = takeLine(`${word} next`, 0, 16, 10)
    expect(taken).toBe(word.length + 1)
  })
})

describe('countLines', () => {
  it('counts an empty paragraph as one line', () => {
    expect(countLines('', 16, 200)).toBe(1)
  })
})

describe('wrapLines', () => {
  it('splits wrapped text into display lines without the break space joining the next line', () => {
    const lines = wrapLines('alpha bravo charlie delta echo', 16, 80)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => !line.text.startsWith(' '))).toBe(true)
  })
})
