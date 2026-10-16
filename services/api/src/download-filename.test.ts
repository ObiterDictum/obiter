import { describe, expect, it } from 'bun:test'

import {
  DOWNLOAD_FILENAME_MAX_LENGTH,
  downloadContentDisposition,
  safeDownloadFilename,
} from './download-filename'

describe('safeDownloadFilename', () => {
  it('keeps an ordinary name unchanged', () => {
    expect(safeDownloadFilename('letter.docx')).toBe('letter.docx')
  })

  it('strips path segments from either separator direction', () => {
    expect(safeDownloadFilename('../etc/passwd')).toBe('passwd')
    expect(safeDownloadFilename('a/b\\c\\evil.docx')).toBe('evil.docx')
    expect(safeDownloadFilename('C:\\Users\\x\\Desktop\\final.docx')).toBe(
      'final.docx',
    )
  })

  it('removes characters illegal in filenames and headers', () => {
    expect(safeDownloadFilename('a<>:"|?*b.docx')).toBe('ab.docx')
    expect(safeDownloadFilename('bad name.docx')).toBe('bad name.docx')
    expect(safeDownloadFilename('bad\x00\x1f\x7f\x9fname.docx')).toBe(
      'badname.docx',
    )
  })

  it('removes bidirectional embedding, override and isolate controls', () => {
    // RLO-wrapped "exe.docx" that renders as "docx.exe" in a file manager.
    expect(safeDownloadFilename('‮exe.docx')).toBe('exe.docx')
    expect(safeDownloadFilename('‮‪⁦a⁧‬⁩b.docx')).toBe('ab.docx')
  })

  it('keeps inert direction marks and full Unicode', () => {
    expect(safeDownloadFilename('مرافعة ‎final‎.docx')).toBe(
      'مرافعة ‎final‎.docx',
    )
    expect(safeDownloadFilename('plädoyer — été.docx')).toBe(
      'plädoyer — été.docx',
    )
  })

  it('appends a required extension exactly once', () => {
    expect(safeDownloadFilename('report', { extension: '.docx' })).toBe(
      'report.docx',
    )
    expect(safeDownloadFilename('report.docx', { extension: '.docx' })).toBe(
      'report.docx',
    )
    expect(safeDownloadFilename('REPORT.DOCX', { extension: '.docx' })).toBe(
      'REPORT.DOCX',
    )
    expect(safeDownloadFilename('report.txt', { extension: '.docx' })).toBe(
      'report.txt.docx',
    )
  })

  it('falls back when the name collapses to nothing', () => {
    expect(safeDownloadFilename('')).toBe('document')
    expect(safeDownloadFilename('‮‬', { extension: '.docx' })).toBe(
      'document.docx',
    )
    expect(safeDownloadFilename('...', { fallback: 'export' })).toBe('export')
  })

  it('bounds the length while keeping the extension', () => {
    const long = `${'a'.repeat(300)}.docx`
    const result = safeDownloadFilename(long, { extension: '.docx' })
    expect(result).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH)
    expect(result.endsWith('.docx')).toBe(true)
  })
})

describe('downloadContentDisposition', () => {
  it('keeps the historic single-parameter form for ASCII names', () => {
    expect(downloadContentDisposition('letter.docx')).toBe(
      'attachment; filename="letter.docx"',
    )
  })

  it('adds an RFC 5987 filename* for non-ASCII names', () => {
    expect(downloadContentDisposition('plädoyer.docx')).toBe(
      'attachment; filename="pl_doyer.docx"; filename*=UTF-8\'\'pl%C3%A4doyer.docx',
    )
  })

  it('percent-encodes characters encodeURIComponent leaves raw', () => {
    expect(downloadContentDisposition("it's — final.docx")).toBe(
      "attachment; filename=\"it's _ final.docx\"; filename*=UTF-8''it%27s%20%E2%80%94%20final.docx",
    )
  })

  it('never emits a header value outside latin-1-safe ASCII', () => {
    const header = downloadContentDisposition('مرافعة.docx')
    expect(header).toMatch(/^[\x20-\x7e]*$/u)
    expect(header).toContain("filename*=UTF-8''")
  })
})
