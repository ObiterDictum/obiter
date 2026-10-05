import { describe, expect, it } from 'bun:test'

import { documentEditOperationSchema } from './document-edit'

function parse(operation: unknown) {
  return documentEditOperationSchema.safeParse(operation)
}

describe('section and break edit contracts', () => {
  it('accepts a bounded section-properties patch', () => {
    expect(
      parse({
        type: 'set_section_properties',
        margins: { top: 720, left: null, gutter: 0 },
        orientation: 'landscape',
        pageSize: { width: 11_906, height: 16_838 },
      }).success,
    ).toBe(true)
    expect(
      parse({ type: 'set_section_properties', margins: null }).success,
    ).toBe(true)
    expect(
      parse({ type: 'set_section_properties', pageSize: null }).success,
    ).toBe(true)
  })

  it('rejects an unassigned section-properties patch and unknown fields', () => {
    expect(parse({ type: 'set_section_properties' }).success).toBe(false)
    expect(
      parse({ type: 'set_section_properties', margins: { top: 1 }, bold: true })
        .success,
    ).toBe(false)
    expect(
      parse({
        type: 'set_section_properties',
        pageSize: { width: -1, height: 10 },
      }).success,
    ).toBe(false)
  })

  it('accepts page and section breaks', () => {
    expect(
      parse({
        type: 'insert_break',
        paragraphId: 'p1',
        offset: 3,
        kind: 'page',
      }).success,
    ).toBe(true)
    expect(
      parse({ type: 'insert_section_break', paragraphId: 'p1' }).success,
    ).toBe(true)
    expect(
      parse({
        type: 'insert_break',
        paragraphId: 'p1',
        offset: 3,
        kind: 'column',
      }).success,
    ).toBe(false)
  })
})
