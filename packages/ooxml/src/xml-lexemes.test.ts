import { describe, expect, it } from 'bun:test'
import { xmlInnerText } from './xml-lexemes'

describe('XML inner text', () => {
  it('keeps CDATA content literal instead of decoding entity references', () => {
    const source = '<![CDATA[&amp; <tag>]]>'
    expect(xmlInnerText(source, 0, source.length)).toBe('&amp; <tag>')
  })
})
