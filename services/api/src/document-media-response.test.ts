import { describe, expect, it } from 'vitest'
import { createDocumentMediaResponse } from './document-media-response'

function disposition(filename?: string) {
  return createDocumentMediaResponse(
    new Uint8Array([1, 2, 3]),
    'application/octet-stream',
    filename,
  ).headers.get('content-disposition')
}

describe('createDocumentMediaResponse content-disposition', () => {
  it('keeps pure-ASCII names in the historic single-parameter form', () => {
    expect(disposition('bundle.pdf')).toBe('attachment; filename="bundle.pdf"')
    expect(disposition('my report (final).pdf')).toBe(
      'attachment; filename="my report (final).pdf"',
    )
  })

  it('strips quotes and serves bare attachment without a name', () => {
    expect(disposition('my "report".pdf')).toBe(
      'attachment; filename="my report.pdf"',
    )
    expect(disposition(undefined)).toBe('attachment')
    expect(disposition('')).toBe('attachment')
  })

  it('encodes a non-ASCII letter as RFC 5987 with an ASCII fallback', () => {
    expect(disposition('Müller.docx')).toBe(
      'attachment; filename="M_ller.docx"; filename*=UTF-8\'\'M%C3%BCller.docx',
    )
  })

  it('encodes characters above U+00FF instead of throwing in header construction', () => {
    expect(disposition('判決.pdf')).toBe(
      'attachment; filename="__.pdf"; filename*=UTF-8\'\'%E5%88%A4%E6%B1%BA.pdf',
    )
  })

  it('encodes a mixed space, quote, non-ASCII and above-U+00FF name', () => {
    expect(disposition('my "report" ü 判.txt')).toBe(
      'attachment; filename="my report _ _.txt"; filename*=UTF-8\'\'my%20report%20%C3%BC%20%E5%88%A4.txt',
    )
  })
})
