import { describe, expect, it } from 'bun:test'
import { appendPropertyChange } from './tracked-edit-xml'

describe('appendPropertyChange', () => {
  it('inserts before the same closing suffix as the original expression', () => {
    const marker = '<w:pPrChange id="1">old</w:pPrChange>'
    for (const properties of [
      '<w:pPr></w:pPr>',
      'abc</one</two>',
      'abc',
      'abc</tag>\n',
    ]) {
      expect(
        appendPropertyChange(properties, 'w', 'pPr', 'id="1"', 'old'),
      ).toBe(properties.replace(/(<\/[^>]+>)$/u, `${marker}$1`))
    }
  })

  it('finishes quickly on a long unterminated closing-tag run', () => {
    const properties = '</'.repeat(100_000)
    const start = performance.now()
    expect(appendPropertyChange(properties, 'w', 'pPr', 'id="1"', 'old')).toBe(
      properties,
    )
    expect(performance.now() - start).toBeLessThan(50)
  })
})
