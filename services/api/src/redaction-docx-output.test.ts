import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '@obiter/ooxml'

import {
  buildRedactedDocx,
  isDocxMimeOrFilename,
  redactedDocxFilename,
  RedactionDocxBurnError,
} from './redaction-docx-output'

const NAME = 'Jonathan Pryce'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function contentTypes(extra: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}</Types>`
}

function rels(extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>${extra}</Relationships>`
}

function documentRels(extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${extra}</Relationships>`
}

const FOOTNOTES_REL =
  '<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
const COMMENTS_REL =
  '<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'

function documentXml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
}

const BODY = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Dear </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Jonathan </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Pryce</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell for ${NAME}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`

const FOOTNOTES_XML = `<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="${W_NS}"><w:footnote w:id="1"><w:p><w:r><w:t>Note about ${NAME} here</w:t></w:r></w:p></w:footnote></w:footnotes>`

const CORE_XML = `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${NAME}</dc:creator><cp:lastModifiedBy>${NAME}</cp:lastModifiedBy><cp:revision>2</cp:revision></cp:coreProperties>`
const APP_XML = `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>${NAME}</Company><Manager>Someone Else</Manager></Properties>`
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W_NS}"/>`

async function makeDocx(options?: {
  body?: string
  footnotes?: string | null
  comments?: string | null
}) {
  const zip = new JSZip()
  const withFootnotes = options?.footnotes !== null
  const withComments = options?.comments != null
  let overrides = ''
  if (withFootnotes)
    overrides +=
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
  if (withComments)
    overrides +=
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
  zip.file('[Content_Types].xml', contentTypes(overrides))
  zip.file('_rels/.rels', rels())
  zip.file(
    'word/_rels/document.xml.rels',
    documentRels(
      `${withFootnotes ? FOOTNOTES_REL : ''}${withComments ? COMMENTS_REL : ''}`,
    ),
  )
  zip.file('word/document.xml', documentXml(options?.body ?? BODY))
  if (withFootnotes)
    zip.file('word/footnotes.xml', options?.footnotes ?? FOOTNOTES_XML)
  if (withComments) zip.file('word/comments.xml', options.comments ?? '')
  zip.file('docProps/core.xml', CORE_XML)
  zip.file('docProps/app.xml', APP_XML)
  zip.file('word/styles.xml', STYLES_XML)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

function spanAt(text: string, occurrence: string, nth = 1) {
  let start = -1
  for (let i = 0; i < nth; i += 1) {
    start = text.indexOf(occurrence, start + 1)
    if (start === -1) throw new Error('span text missing from test text')
  }
  return {
    id: `span_${start}_${nth}`,
    start,
    end: start + occurrence.length,
    text: occurrence,
    category: 'person_name' as const,
    source: 'rampart_model' as const,
    confidence: 'high' as const,
    suggestion: 'redact' as const,
  }
}

async function zipEntries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const entries = new Map<string, string>()
  for (const name of Object.keys(zip.files)) {
    const file = zip.file(name)
    if (file && !name.endsWith('/'))
      entries.set(name, await file.async('string'))
  }
  return entries
}

describe('buildRedactedDocx', () => {
  it('burns body and footnote names while keeping styles, tables, and structure', async () => {
    const source = await makeDocx()
    const text = `Dear ${NAME}. [Footnote 1] Note about ${NAME} here`
    const spans = [spanAt(text, NAME, 1), spanAt(text, NAME, 2)]
    const decisions = Object.fromEntries(
      spans.map((span) => [
        span.id,
        {
          decision: 'accept' as const,
          decidedBy: 'usr_1',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )
    const output = await buildRedactedDocx({
      docxBytes: source,
      text,
      spans,
      decisions,
      outputMode: 'redacted',
      tokenMap: {},
    })
    const entries = await zipEntries(output)
    for (const [name, xml] of entries) {
      expect(xml, `name survives in ${name}`).not.toContain(NAME)
    }
    const document = entries.get('word/document.xml') ?? ''
    expect(document).toContain('[REDACTED]')
    expect(document).toContain('Heading1')
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:tbl>')
    expect(entries.get('word/footnotes.xml')).toContain('[REDACTED]')
    // Metadata authorship emptied, non-authorship fields kept.
    expect(entries.get('docProps/core.xml')).toContain(
      '<dc:creator></dc:creator>',
    )
    expect(entries.get('docProps/core.xml')).toContain(
      '<cp:revision>2</cp:revision>',
    )
    expect(entries.get('docProps/app.xml')).toContain('<Company></Company>')
    // Split runs keep unique ids.
    const reparsed = await parseDocx(output)
    const ids = reparsed.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((p) => [p.id, ...p.runs.map((r) => r.id)]),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pseudonymises with the run token map', async () => {
    const source = await makeDocx()
    const text = `Dear ${NAME}.`
    const spans = [spanAt(text, NAME, 1)]
    const decisions = {
      [spans[0]!.id]: {
        decision: 'pseudonymise' as const,
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    const output = await buildRedactedDocx({
      docxBytes: source,
      text,
      spans,
      decisions,
      outputMode: 'pseudonymised',
      tokenMap: { PERSON_NAME_1: NAME },
    })
    const entries = await zipEntries(output)
    for (const [name, xml] of entries) {
      expect(xml, `name survives in ${name}`).not.toContain(NAME)
    }
    expect(entries.get('word/document.xml')).toContain('[PERSON_NAME_1]')
  })

  it('replaces two spans inside one run without duplicating ids', async () => {
    const source = await makeDocx({
      body: `<w:p><w:r><w:t>${NAME} met ${NAME}</w:t></w:r></w:p>`,
      footnotes: null,
    })
    const text = `${NAME} met ${NAME}`
    const spans = [spanAt(text, NAME, 1), spanAt(text, NAME, 2)]
    const decisions = Object.fromEntries(
      spans.map((span) => [
        span.id,
        {
          decision: 'accept' as const,
          decidedBy: 'usr_1',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )
    const output = await buildRedactedDocx({
      docxBytes: source,
      text,
      spans,
      decisions,
      outputMode: 'redacted',
      tokenMap: {},
    })
    const entries = await zipEntries(output)
    const document = entries.get('word/document.xml') ?? ''
    expect(document).not.toContain(NAME)
    expect(document.match(/\[REDACTED\]/g)?.length).toBe(2)
    const reparsed = await parseDocx(output)
    const ids = reparsed.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((p) => p.runs.map((r) => r.id)),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses when redacted text sits inside a tracked deletion', async () => {
    const source = await makeDocx({
      body: `<w:p><w:r><w:t>Kept text</w:t></w:r></w:p><w:p><w:del w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>${NAME}</w:delText></w:r></w:del></w:p>`,
    })
    const text = 'Kept text'
    await expect(
      buildRedactedDocx({
        docxBytes: source,
        text,
        spans: [],
        decisions: {},
        outputMode: 'redacted',
        tokenMap: {},
      }),
    ).resolves.toBeDefined()
    const sneaky = `${text} ${NAME}`
    const spans = [spanAt(sneaky, NAME, 1)]
    await expect(
      buildRedactedDocx({
        docxBytes: source,
        text: sneaky,
        spans,
        decisions: {
          [spans[0]!.id]: {
            decision: 'accept',
            decidedBy: 'usr_1',
            decidedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        outputMode: 'redacted',
        tokenMap: {},
      }),
    ).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })

  it('refuses comment-bearing documents', async () => {
    const source = await makeDocx({
      comments: `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="${W_NS}"><w:comment w:id="0" w:author="R" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment></w:comments>`,
    })
    const text = `Dear ${NAME}.`
    const spans = [spanAt(text, NAME, 1)]
    await expect(
      buildRedactedDocx({
        docxBytes: source,
        text,
        spans,
        decisions: {
          [spans[0]!.id]: {
            decision: 'accept',
            decidedBy: 'usr_1',
            decidedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        outputMode: 'redacted',
        tokenMap: {},
      }),
    ).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })
})

describe('redactedDocxFilename', () => {
  it('swaps the extension and leaves other names intact', () => {
    expect(redactedDocxFilename('letter.docx')).toBe('letter-redacted.docx')
    expect(redactedDocxFilename('letter.DOCX')).toBe('letter-redacted.docx')
    expect(redactedDocxFilename('letter')).toBe('letter-redacted.docx')
  })

  it('detects docx mime or filename', () => {
    expect(
      isDocxMimeOrFilename(
        'letter.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true)
    expect(isDocxMimeOrFilename('letter.docx', null)).toBe(true)
    expect(isDocxMimeOrFilename('letter.pdf', 'application/pdf')).toBe(false)
    expect(isDocxMimeOrFilename('notes.txt', 'text/plain')).toBe(false)
  })
})
