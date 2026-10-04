import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import type { RedactionSpan } from '@obiter/redaction-policy'
import type { RedactionRunRecord } from './redaction-database'
import {
  buildHardRedactionPdf,
  hardRedactionFailureCategory,
  type HardRedactionSource,
} from './redaction-hard-output'
import type { RedactionRenderer } from './redaction-renderer'
import type { StorageService } from './storage'

const SOURCE_TEXT = 'Alice Smith signed the deed.'

function span(text: string, start: number): RedactionSpan {
  return {
    id: 'span_1',
    start,
    end: start + text.length,
    text,
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  }
}

function run(
  overrides: Partial<RedactionRunRecord>,
  spans: RedactionSpan[] = [],
): RedactionRunRecord {
  return {
    id: 'red_1',
    organisationId: 'org_1',
    matterId: null,
    matterName: null,
    documentId: null,
    documentVersionId: null,
    sourceFilename: 'source.txt',
    sourceTextObjectKey: 'org/org_1/redaction-runs/red_1/source',
    sourceFileObjectKey: null,
    sourceLayoutObjectKey: null,
    sourceMimeType: 'text/plain',
    status: 'ready_for_review',
    policyMode: 'internal_ai_minimisation',
    spans,
    decisions: Object.fromEntries(
      spans.map((item) => [
        item.id,
        {
          decision: 'accept' as const,
          decidedBy: 'usr_1',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ),
    outputArtifactId: null,
    summary: { totalSpans: spans.length } as RedactionRunRecord['summary'],
    detectorVersion: null,
    detectionMode: 'model+supplement',
    replacesRunId: null,
    replacementRunId: null,
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function textStorage(text: string): StorageService {
  return {
    readText: async () => text,
    writeText: async () => undefined,
    delete: async () => undefined,
  }
}

async function minimalDocx(bodyXml: string) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      bodyXml +
      '</w:body></w:document>',
  )
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

async function blankPdf() {
  const document = await PDFDocument.create()
  document.addPage([200, 200])
  return new Uint8Array(await document.save())
}

describe('buildHardRedactionPdf', () => {
  it('turns a text source into an image-only secure PDF', async () => {
    const alice = span('Alice', 0)
    const result = await buildHardRedactionPdf({
      run: run({}, [alice]),
      sourceText: SOURCE_TEXT,
      redactedText: '[REDACTED] Smith signed the deed.',
      source: null,
      layoutObjectKey: null,
      storage: textStorage(SOURCE_TEXT),
      renderer: null,
      tokenMap: {},
    })
    expect(Buffer.from(result.bytes).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    )
    expect(result.filename).toBe('source-redacted.pdf')
  })

  it('burns the docx before rendering and rasterizes the renderer PDF', async () => {
    const docx = await minimalDocx('<w:p><w:r><w:t>Alice</w:t></w:r></w:p>')
    let rendered: Buffer | null = null
    const renderer: RedactionRenderer = {
      renderDocxToPdf: async (bytes) => {
        rendered = bytes
        return blankPdf()
      },
    }
    const result = await buildHardRedactionPdf({
      run: run(
        {
          sourceFilename: 'letter.docx',
          sourceMimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceFileObjectKey: 'org/org_1/redaction-runs/red_1/original',
        },
        [span('Alice', 0)],
      ),
      sourceText: 'Alice',
      redactedText: '[REDACTED]',
      source: {
        objectKey: 'org/org_1/redaction-runs/red_1/original',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'letter.docx',
      } satisfies HardRedactionSource,
      layoutObjectKey: null,
      storage: {
        readText: async () => 'Alice',
        readBinary: async () => docx,
        writeText: async () => undefined,
        delete: async () => undefined,
      },
      renderer,
      tokenMap: {},
    })
    // The renderer receives the sanitized .docx, never the original name.
    expect(rendered).not.toBeNull()
    const zip = await JSZip.loadAsync(rendered ?? Buffer.alloc(0))
    const documentXml =
      (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(documentXml).toContain('[REDACTED]')
    expect(documentXml).not.toContain('Alice')
    expect(result.filename).toBe('letter-redacted.pdf')
  })

  it('refuses a docx source when no renderer is configured', async () => {
    const docx = await minimalDocx('<w:p><w:r><w:t>Alice</w:t></w:r></w:p>')
    await expect(
      buildHardRedactionPdf({
        run: run({
          sourceFilename: 'letter.docx',
          sourceMimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceFileObjectKey: 'org/org_1/redaction-runs/red_1/original',
        }),
        sourceText: 'Alice',
        redactedText: '[REDACTED]',
        source: {
          objectKey: 'org/org_1/redaction-runs/red_1/original',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: 'letter.docx',
        },
        layoutObjectKey: null,
        storage: {
          readText: async () => 'Alice',
          readBinary: async () => docx,
          writeText: async () => undefined,
          delete: async () => undefined,
        },
        renderer: null,
        tokenMap: {},
      }),
    ).rejects.toMatchObject({ category: 'renderer_unavailable' })
  })

  it('maps a renderer failure to its stable category', async () => {
    const docx = await minimalDocx('<w:p><w:r><w:t>Alice</w:t></w:r></w:p>')
    const renderer: RedactionRenderer = {
      renderDocxToPdf: async () => {
        throw new Error('renderer exploded')
      },
    }
    try {
      await buildHardRedactionPdf({
        run: run({
          sourceFilename: 'letter.docx',
          sourceMimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceFileObjectKey: 'org/org_1/redaction-runs/red_1/original',
        }),
        sourceText: 'Alice',
        redactedText: '[REDACTED]',
        source: {
          objectKey: 'org/org_1/redaction-runs/red_1/original',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: 'letter.docx',
        },
        layoutObjectKey: null,
        storage: {
          readText: async () => 'Alice',
          readBinary: async () => docx,
          writeText: async () => undefined,
          delete: async () => undefined,
        },
        renderer,
        tokenMap: {},
      })
      throw new Error('expected refusal')
    } catch (error) {
      expect(hardRedactionFailureCategory(error)).toBe('renderer_error')
    }
  })

  it('rasterizes a zero-span PDF source without needing a renderer', async () => {
    const document = await PDFDocument.create()
    document.addPage([200, 200])
    const pdf = Buffer.from(await document.save())
    const result = await buildHardRedactionPdf({
      run: run({
        sourceFilename: 'brief.pdf',
        sourceMimeType: 'application/pdf',
        sourceFileObjectKey: 'org/org_1/redaction-runs/red_1/original',
        sourceLayoutObjectKey: 'org/org_1/redaction-runs/red_1/layout.json',
      }),
      sourceText: '',
      redactedText: '',
      source: {
        objectKey: 'org/org_1/redaction-runs/red_1/original',
        mimeType: 'application/pdf',
        filename: 'brief.pdf',
      },
      layoutObjectKey: 'org/org_1/redaction-runs/red_1/layout.json',
      storage: {
        readText: async () =>
          JSON.stringify({
            version: 2,
            pages: [{ width: 1, height: 1 }],
            segments: [],
          }),
        readBinary: async () => pdf,
        writeText: async () => undefined,
        delete: async () => undefined,
      },
      renderer: null,
      tokenMap: {},
    })
    expect(result.filename).toBe('brief-redacted.pdf')
  })
})
