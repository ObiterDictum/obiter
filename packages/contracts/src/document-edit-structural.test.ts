import { describe, expect, it } from 'bun:test'

import {
  DOCUMENT_EDIT_HYPERLINK_TARGET_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
  DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_TABLE_MAX_COLUMNS,
  DOCUMENT_EDIT_TABLE_MAX_ROWS,
} from './document-edit-structural'
import { DOCUMENT_EDIT_TEXT_MAX_LENGTH } from './document-edit-shared'
import { documentEditRequestSchema } from './document-edit-request'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUg=='

const table = {
  type: 'insert_table' as const,
  paragraphId: 'para_1',
  rows: 2,
  columns: 3,
}

const image = {
  type: 'insert_image' as const,
  paragraphId: 'para_1',
  offset: 4,
  contentType: 'image/png' as const,
  dataBase64: PNG_BASE64,
  widthPx: 120,
  heightPx: 80,
  name: 'Figure 1',
}

const hyperlink = {
  type: 'set_hyperlink' as const,
  paragraphId: 'para_1',
  from: 2,
  to: 7,
  target: 'https://example.co.uk/authority',
}

const crossReference = {
  type: 'insert_cross_reference' as const,
  paragraphId: 'para_1',
  offset: 4,
  targetParagraphId: 'para_2',
}

const pageNumber = {
  type: 'insert_page_number' as const,
  paragraphId: 'para_1',
  offset: 4,
}

const footnote = {
  type: 'insert_footnote' as const,
  paragraphId: 'para_1',
  offset: 4,
  text: 'Note body text',
}

const parse = (operations: unknown[]) =>
  documentEditRequestSchema.safeParse({
    baseVersionId: 'ver_1',
    operations,
  })

describe('structural edit contracts', () => {
  it('accepts bounded table and image insertions', () => {
    const parsed = parse([table, image])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.operations[0]).toEqual(table)
    expect(parsed.data.operations[1]).toEqual(image)
  })

  it.each([
    ['zero rows', { ...table, rows: 0 }],
    ['too many rows', { ...table, rows: DOCUMENT_EDIT_TABLE_MAX_ROWS + 1 }],
    ['a fractional row count', { ...table, rows: 1.5 }],
    ['zero columns', { ...table, columns: 0 }],
    [
      'too many columns',
      { ...table, columns: DOCUMENT_EDIT_TABLE_MAX_COLUMNS + 1 },
    ],
    ['an extra field', { ...table, styleId: 'TableGrid' }],
  ])('rejects a table with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })

  it.each([
    ['a negative offset', { ...image, offset: -1 }],
    ['a fractional offset', { ...image, offset: 0.5 }],
    ['an unsupported content type', { ...image, contentType: 'image/svg+xml' }],
    ['malformed base64', { ...image, dataBase64: 'not base64!' }],
    [
      'oversize image data',
      {
        ...image,
        dataBase64: 'A'.repeat(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH + 4),
      },
    ],
    [
      'an oversized width',
      { ...image, widthPx: DOCUMENT_EDIT_IMAGE_DIMENSION_MAX + 1 },
    ],
    ['a zero height', { ...image, heightPx: 0 }],
    [
      'an overlong name',
      { ...image, name: 'x'.repeat(DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH + 1) },
    ],
    [
      'an unsupported XML character in the name',
      { ...image, name: 'bad\u0000name' },
    ],
    ['an empty name', { ...image, name: '' }],
    ['an extra field', { ...image, caption: 'x' }],
  ])('rejects an image with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })

  it('accepts a maximum-sized valid base64 payload without overflowing', () => {
    const parsed = parse([
      { ...image, dataBase64: 'A'.repeat(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH) },
    ])
    expect(parsed.success).toBe(true)
  })

  it('rejects a maximum-sized invalid base64 payload without overflowing', () => {
    // One bad character at the tail of a bound-length string; the check is a
    // linear scan, so this cannot throw a stack RangeError the way the old
    // regex did at 8 MiB.
    const parsed = parse([
      {
        ...image,
        dataBase64: `${'A'.repeat(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH - 1)}!`,
      },
    ])
    expect(parsed.success).toBe(false)
  })

  it.each([
    ['unpadded group', 'AQID'],
    ['single padding', 'AQI='],
    ['double padding', 'AQ=='],
    ['padding mid-string', 'A=AA'],
    ['padding only', '===='],
    ['a length not divisible by four', 'AQIDB'],
  ])('handles base64 edge case %s', (_label, dataBase64) => {
    const parsed = parse([{ ...image, dataBase64 }])
    const valid =
      dataBase64 === 'AQID' || dataBase64 === 'AQI=' || dataBase64 === 'AQ=='
    expect(parsed.success).toBe(valid)
  })

  it('accepts every supported image content type', () => {
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/bmp',
    ] as const) {
      expect(parse([{ ...image, contentType }]).success).toBe(true)
    }
  })

  it('accepts a hyperlink set, a hyperlink removal and a cross-reference', () => {
    const parsed = parse([
      hyperlink,
      { ...hyperlink, target: null },
      crossReference,
      { ...hyperlink, target: 'mailto:clerk@example.co.uk' },
    ])
    expect(parsed.success).toBe(true)
  })

  it.each([
    ['a javascript URL', { ...hyperlink, target: 'javascript:alert(1)' }],
    ['a data URL', { ...hyperlink, target: 'data:text/html,<b>x</b>' }],
    ['a file URL', { ...hyperlink, target: 'file:///etc/passwd' }],
    ['a relative path', { ...hyperlink, target: '/authorities/1' }],
    ['no scheme', { ...hyperlink, target: 'example.co.uk' }],
    ['a missing mailto path', { ...hyperlink, target: 'mailto:' }],
    ['a missing http host', { ...hyperlink, target: 'https://' }],
    ['an empty target', { ...hyperlink, target: '' }],
    [
      'an overlong target',
      {
        ...hyperlink,
        target: `https://example.co.uk/${'a'.repeat(DOCUMENT_EDIT_HYPERLINK_TARGET_MAX_LENGTH)}`,
      },
    ],
    ['a reversed range', { ...hyperlink, from: 7, to: 2 }],
    ['an empty range', { ...hyperlink, from: 4, to: 4 }],
    ['a negative offset', { ...hyperlink, from: -1 }],
    ['an extra field', { ...hyperlink, anchor: 'rId1' }],
  ])('rejects a hyperlink with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })

  it.each([
    ['a negative offset', { ...crossReference, offset: -1 }],
    ['a fractional offset', { ...crossReference, offset: 1.5 }],
    ['a missing target', { ...crossReference, targetParagraphId: '' }],
    ['an extra field', { ...crossReference, bookmark: 'x' }],
  ])('rejects a cross-reference with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })

  it('accepts a page-number insertion', () => {
    const parsed = parse([pageNumber])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.operations[0]).toEqual(pageNumber)
  })

  it.each([
    ['a negative offset', { ...pageNumber, offset: -1 }],
    ['a fractional offset', { ...pageNumber, offset: 1.5 }],
    ['a value', { ...pageNumber, page: 3 }],
    ['an extra field', { ...pageNumber, targetParagraphId: 'para_2' }],
  ])('rejects a page number with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })

  it('accepts a footnote insertion and normalises its note text', () => {
    const parsed = parse([footnote, { ...footnote, text: 'a\r\nb\rc' }])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.operations[0]).toEqual(footnote)
    expect(parsed.data.operations[1]).toEqual({
      ...footnote,
      text: 'a\nb\nc',
    })
  })

  it.each([
    ['a negative offset', { ...footnote, offset: -1 }],
    ['a fractional offset', { ...footnote, offset: 0.5 }],
    ['a missing text', { ...footnote, text: undefined }],
    [
      'an unsupported XML character in the text',
      { ...footnote, text: 'badtext' },
    ],
    [
      'overlong text',
      { ...footnote, text: 'x'.repeat(DOCUMENT_EDIT_TEXT_MAX_LENGTH + 1) },
    ],
    ['an extra field', { ...footnote, noteId: 'fn_1' }],
  ])('rejects a footnote with %s', (_label, operation) => {
    expect(parse([operation]).success).toBe(false)
  })
})
