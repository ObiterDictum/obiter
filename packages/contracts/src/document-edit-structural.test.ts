import { describe, expect, it } from 'bun:test'

import {
  DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
  DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_TABLE_MAX_COLUMNS,
  DOCUMENT_EDIT_TABLE_MAX_ROWS,
} from './document-edit-structural'
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
})
