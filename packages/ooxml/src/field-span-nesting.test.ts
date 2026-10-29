import { describe, expect, it } from 'bun:test'

import {
  fieldSpans,
  nestedFieldSpans,
  spanNestedInField,
  type StoredFieldSpan,
} from './field-spans'
import { parseXmlElements } from './parts/overlay'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const begin = (id: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> ${id} </w:instrText></w:r>`
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'

function part(body: string) {
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

function spansOf(body: string): readonly StoredFieldSpan[] {
  const source = part(body)
  return fieldSpans(parseXmlElements(source), source)
}

function oneByOne(spans: readonly StoredFieldSpan[]) {
  return new Set(spans.filter((span) => spanNestedInField(spans, span)))
}

function expectSameAnswer(spans: readonly StoredFieldSpan[]) {
  const batched = nestedFieldSpans(spans)
  const one = oneByOne(spans)
  expect(batched.size).toBe(one.size)
  for (const span of spans) expect(batched.has(span)).toBe(one.has(span))
  return batched
}

describe('batched field nesting', () => {
  it('matches the per-span answer on sequential fields', () => {
    const spans = spansOf(
      `<w:p>${begin('A')}${end}</w:p><w:p>${begin('B')}${end}</w:p><w:p>${begin('C')}${end}</w:p>`,
    )
    expect(spans).toHaveLength(3)
    expect(nestedFieldSpans(spans).size).toBe(0)
    expectSameAnswer(spans)
  })

  it('matches the per-span answer on nested fields', () => {
    const spans = spansOf(`<w:p>${begin('A')}${begin('B')}${end}${end}</w:p>`)
    expect(spans).toHaveLength(2)
    const nested = expectSameAnswer(spans)
    expect(nested.size).toBe(1)
    const inner = spans.find(
      (span) => span.beginParagraph === spans[1]?.beginParagraph,
    )
    expect(nested.has(inner ?? (spans[1] as StoredFieldSpan))).toBe(true)
  })

  it('matches the per-span answer when a field never closes', () => {
    const spans = spansOf(`<w:p>${begin('A')}${begin('B')}${end}</w:p>`)
    expect(spans).toHaveLength(2)
    const nested = expectSameAnswer(spans)
    expect(nested.size).toBe(1)
  })

  it('matches the per-span answer on a long spread of shapes', () => {
    const spans = spansOf(
      [
        `<w:p>${begin('A')}${end}</w:p>`,
        `<w:p>${begin('B')}${begin('C')}${end}${end}</w:p>`,
        `<w:p>${begin('D')}</w:p>`,
        `<w:p>${begin('E')}${end}</w:p>`,
        `<w:p>${begin('F')}${begin('G')}${begin('H')}${end}${end}${end}</w:p>`,
        `<w:p>${begin('I')}${end}</w:p>`,
      ].join(''),
    )
    expect(spans.length).toBeGreaterThanOrEqual(8)
    expect(expectSameAnswer(spans).size).toBeGreaterThan(0)
  })

  it('answers in linear time where the per-span question is quadratic', () => {
    const time = (fields: number) => {
      const spans = spansOf(
        Array.from(
          { length: fields },
          (_, index) => `<w:p>${begin(`b${index}`)}${end}</w:p>`,
        ).join(''),
      )
      expect(spans).toHaveLength(fields)
      const started = Date.now()
      const nested = nestedFieldSpans(spans)
      return { elapsed: Date.now() - started, nested: nested.size }
    }
    const small = time(1_000)
    const large = time(8_000)
    expect(small.nested).toBe(0)
    expect(large.nested).toBe(0)
    expect(large.elapsed).toBeLessThan(250)
    expect(large.elapsed).toBeLessThan(Math.max(50, small.elapsed * 24))
  })
})
