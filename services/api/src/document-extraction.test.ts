import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supplementSpans } from '@obiter/redaction-policy'

const unpdf = vi.hoisted(() => ({ getDocumentProxy: vi.fn() }))

vi.mock('unpdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('unpdf')>()),
  getDocumentProxy: unpdf.getDocumentProxy,
}))

import {
  DocumentExtractionError,
  extractDocumentText,
  IMAGE_ONLY_DOCX_MESSAGE,
  UNREADABLE_DOCX_MESSAGE,
} from './document-extraction'
import { createRedactionDetector } from './redaction-detection'

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
  unpdf.getDocumentProxy.mockReset()
  unpdf.getDocumentProxy.mockImplementation(actual.getDocumentProxy)
})

async function createMinimalDocx(
  options: {
    imageOnly?: boolean
    supplementalImage?: 'header' | 'footer'
  } = {},
) {
  const archive = new JSZip()
  const supplementalPart = options.supplementalImage
  const supplementalName = supplementalPart ? `${supplementalPart}1.xml` : null
  archive.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${supplementalName ? `<Override PartName="/word/${supplementalName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${supplementalPart}+xml"/>` : ''}</Types>`,
  )
  archive.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  archive.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${options.imageOnly ? '<w:p><w:r><w:drawing><pic:pic/></w:drawing></w:r></w:p>' : '<w:p/>'}${supplementalPart ? `<w:sectPr><w:${supplementalPart}Reference w:type="default" r:id="rIdSupplemental"/></w:sectPr>` : ''}</w:body></w:document>`,
  )
  const documentRelationships = options.imageOnly
    ? '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    : supplementalPart
      ? `<Relationship Id="rIdSupplemental" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${supplementalPart}" Target="${supplementalName}"/>`
      : ''
  archive.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRelationships}</Relationships>`,
  )
  if (supplementalPart && supplementalName) {
    const root = supplementalPart === 'header' ? 'hdr' : 'ftr'
    archive.file(
      `word/${supplementalName}`,
      `<?xml version="1.0"?><w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:r><w:drawing><pic:pic/></w:drawing></w:r></w:p></w:${root}>`,
    )
    archive.file(
      `word/_rels/${supplementalName}.rels`,
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    )
  }
  if (options.imageOnly || supplementalPart)
    archive.file('word/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return archive.generateAsync({ type: 'nodebuffer' })
}

describe('extractDocumentText', () => {
  it('extracts text from the checked-in DOCX demo fixture', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    await expect(extractDocumentText('docx', fixture)).resolves.toContain(
      'Mr James Cartwright',
    )
  })

  it('keeps readable body text when optional header/footer parsing fails', async () => {
    const fixture = await readFile('../../data/evals/redact/demo-fixture.docx')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const text = await extractDocumentText('docx', fixture, {
      extractDocxSupplementalContent: async () => {
        throw new Error('supplemental parser failed')
      },
    })

    expect(text).toContain('Mr James Cartwright')
    expect(warn).toHaveBeenCalledWith('DOCX header/footer extraction warning', {
      reason: 'supplemental parser failed',
    })
    warn.mockRestore()
  })

  it('rejects an empty DOCX as unreadable, not image-only, when parsing fails', async () => {
    const fixture = await createMinimalDocx()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      extractDocumentText('docx', fixture, {
        extractDocxSupplementalContent: async () => {
          throw new Error('supplemental parser failed')
        },
      }),
    ).rejects.toThrow(UNREADABLE_DOCX_MESSAGE)
    expect(warn).toHaveBeenCalledWith('DOCX header/footer extraction warning', {
      reason: 'supplemental parser failed',
    })
    warn.mockRestore()
  })

  it('rejects an image-only DOCX instead of presenting a clean zero-span run', async () => {
    const fixture = await createMinimalDocx({ imageOnly: true })

    await expect(extractDocumentText('docx', fixture)).rejects.toThrow(
      IMAGE_ONLY_DOCX_MESSAGE,
    )
  })

  it.each(['header', 'footer'] as const)(
    'rejects a DOCX whose only content is an image in its %s',
    async (supplementalImage) => {
      const fixture = await createMinimalDocx({ supplementalImage })

      await expect(extractDocumentText('docx', fixture)).rejects.toThrow(
        IMAGE_ONLY_DOCX_MESSAGE,
      )
    },
  )

  it('allows a genuinely empty DOCX and produces zero detection spans', async () => {
    const fixture = await createMinimalDocx()
    const text = await extractDocumentText('docx', fixture)
    const detection = await createRedactionDetector({
      log: () => undefined,
    })(text)

    expect(text).toBe('')
    expect(detection.spans).toEqual([])
  })

  it('extracts DOCX body, table, header and footer text', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/docx-edge-cases-fixture.docx',
    )

    const text = await extractDocumentText('docx', fixture)

    expect(text).toContain('Header: Alice Example')
    expect(text).toContain('Body: Jane Example')
    expect(text).toContain('Table: Sarah Example')
    expect(text).toContain('Footer: Bob Example')
  })

  it('joins text-layer PDF pages and preserves known PII without detaching the source buffer', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-text-layer-fixture.pdf',
    )
    const source = Buffer.from(fixture)
    await expect(extractDocumentText('pdf', source)).resolves.toContain(
      'NI: QQ 12 34 56 C\n\nPlease contact Mr Amina Rahman',
    )
    await expect(extractDocumentText('pdf', source)).resolves.toContain(
      'amina.rahman@example.test',
    )
    expect(source).toEqual(fixture)
  })

  it('normalises per-character PDF spacing before UK supplement detection', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-spaced-pii-fixture.pdf',
    )
    const text = await extractDocumentText('pdf', fixture)
    expect(text).toContain('QQ123456C')
    expect(text).toContain('amina@example.test')
    expect(text).toContain('I am a QC')
    expect(supplementSpans(text)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'national_insurance',
          text: 'QQ123456C',
        }),
        expect.objectContaining({
          category: 'email',
          text: 'amina@example.test',
        }),
      ]),
    )
  })

  it('allows a short one-page text-layer PDF', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-short-text-layer-fixture.pdf',
    )
    await expect(extractDocumentText('pdf', fixture)).resolves.toBe(
      'Brief note.',
    )
  })

  it('rejects scanned-like PDFs with no text, sparse multi-page text, or zero-width padding', async () => {
    const emptyFixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const lowTextFixture = await readFile(
      '../../data/evals/redact/pdf-low-text-multipage-fixture.pdf',
    )
    const zeroWidthFixture = await readFile(
      '../../data/evals/redact/pdf-zero-width-scanned-fixture.pdf',
    )
    for (const fixture of [emptyFixture, lowTextFixture, zeroWidthFixture])
      await expect(extractDocumentText('pdf', fixture)).rejects.toThrow(
        'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
      )
  })

  it('preserves successful extraction when PDF cleanup fails', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-short-text-layer-fixture.pdf',
    )
    const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
    const pdf = await actual.getDocumentProxy(new Uint8Array(fixture))
    vi.spyOn(pdf, 'destroy').mockRejectedValue(new Error('cleanup failed'))
    unpdf.getDocumentProxy.mockResolvedValue(pdf)

    await expect(extractDocumentText('pdf', fixture)).resolves.toBe(
      'Brief note.',
    )
  })

  it('preserves the scanned-PDF error when PDF cleanup fails', async () => {
    const fixture = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
    const pdf = await actual.getDocumentProxy(new Uint8Array(fixture))
    vi.spyOn(pdf, 'destroy').mockRejectedValue(new Error('cleanup failed'))
    unpdf.getDocumentProxy.mockResolvedValue(pdf)

    await expect(extractDocumentText('pdf', fixture)).rejects.toThrow(
      'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.',
    )
  })

  it('turns corrupt DOCX bytes into a deliberate extraction error', async () => {
    await expect(
      extractDocumentText('docx', Buffer.from('not a docx')),
    ).rejects.toBeInstanceOf(DocumentExtractionError)
  })

  it('preserves TXT content', async () => {
    await expect(
      extractDocumentText('txt', Buffer.from('No PII here.')),
    ).resolves.toBe('No PII here.')
  })
})
