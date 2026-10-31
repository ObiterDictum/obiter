import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import {
  clearLineBreakCache,
  countLines,
  takeLine,
  wrapLines,
} from './document-page-flow'

const registered: Array<[string, unknown]> = []
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: {
    addEventListener: (type: string, listener: unknown) => {
      registered.push([type, listener])
    },
  },
})

const paragraphs = [
  'The Claimant seeks damages for breach of clause 4.2 of the agreement dated 1 March 2024.',
  'Short.',
  'A paragraph with a hyphenated-term and a\nmanual line break, followed by a long tail of ordinary words.',
  'Supercalifragilisticexpialidociouswordwithoutanybreakopportunityatall',
  '',
]

describe('line-break cache', () => {
  it('clears itself when web fonts finish loading', () => {
    takeLine(paragraphs[0]!, 0, 16, 200)
    expect(registered).toEqual([['loadingdone', clearLineBreakCache]])
  })

  it('returns the same breaks as a fresh measurement', () => {
    for (const text of paragraphs) {
      for (const width of [40, 120, 333.5, 2000]) {
        for (let offset = 0; offset <= text.length; offset += 7) {
          clearLineBreakCache()
          const fresh = takeLine(text, offset, 14, width)
          expect(takeLine(text, offset, 14, width)).toBe(fresh)
          expect(takeLine(text, offset, 14, width, 'Georgia')).toBe(
            takeLine(text, offset, 14, width, 'Georgia'),
          )
        }
        clearLineBreakCache()
        const lines = wrapLines(text, 14, width)
        const count = countLines(text, 14, width)
        expect(wrapLines(text, 14, width)).toEqual(lines)
        expect(countLines(text, 14, width)).toBe(count)
      }
    }
  })

  it('keys breaks by width so a narrower column wraps again', () => {
    const text = paragraphs[0]!
    const wide = takeLine(text, 0, 16, 2000)
    const narrow = takeLine(text, 0, 16, 60)
    expect(wide).toBe(text.length)
    expect(narrow).toBeLessThan(wide)
  })
})
