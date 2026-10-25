import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createSyntheticDocx, parseXmlElements, isWord } from '@obiter/ooxml'
import { extractDocumentText } from './document-extraction'
import { buildRedactedDocx } from './redaction-docx-output'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const r = (value: string) => `<w:r>${value}</w:r>`
const p = (value: string) => `<w:p>${r(value)}</w:p>`
const t = (value: string) => `<w:t>${value}</w:t>`
async function source(
  body: string,
  extra: Record<string, string | Uint8Array> = {},
) {
  const zip = await JSZip.loadAsync(await createSyntheticDocx(['fixture']))
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`,
  )
  for (const [name, value] of Object.entries(extra)) zip.file(name, value)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
async function burn(
  body: string,
  names: string[],
  extra: Record<string, string | Uint8Array> = {},
  starts?: number[],
) {
  const docxBytes = await source(body, extra)
  const text = await extractDocumentText('docx', docxBytes)
  const spans = names.map((name, i) => ({
    id: `s${i}`,
    text: name,
    start: starts?.[i] ?? text.indexOf(name),
    end: (starts?.[i] ?? text.indexOf(name)) + name.length,
    category: 'person_name' as const,
    source: 'rampart_model' as const,
    confidence: 'high' as const,
    suggestion: 'redact' as const,
  }))
  const bytes = await buildRedactedDocx({
    docxBytes,
    text,
    spans,
    decisions: Object.fromEntries(
      spans.map((span) => [
        span.id,
        {
          decision: 'accept' as const,
          decidedBy: 'test',
          decidedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ),
    outputMode: 'redacted',
    tokenMap: {},
  })
  const zip = await JSZip.loadAsync(bytes)
  const documentPart = zip.file('word/document.xml')
  if (!documentPart) throw new Error('Missing output document')
  return {
    xml: await documentPart.async('string'),
    comments: (await zip.file('word/comments.xml')?.async('string')) ?? '',
    text: await extractDocumentText('docx', Buffer.from(bytes)),
  }
}
const textBox = (text: string) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent>${p(t(text))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${p(t(text))}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`

describe('accepted DOCX coordinates and container safety', () => {
  it('burns accepted Ann while preserving Annual and Hannah', async () => {
    const output = await burn(p(t('Ann Annual Hannah')), ['Ann'])
    expect(output.text).toBe('[REDACTED] Annual Hannah')
  })
  it('preserves the rejected duplicate Apple at its original position', async () => {
    const output = await burn(p(t('Apple Apple')), ['Apple'], {}, [6])
    expect(output.text).toBe('Apple [REDACTED]')
  })
  it('burns accepted 24 without changing 2024, font sizes or dates', async () => {
    const output = await burn(
      p('<w:rPr><w:sz w:val="24"/></w:rPr>' + t('24 in 2024')),
      ['24'],
      {
        'docProps/core.xml':
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/"><dcterms:created>2024-01-01T00:00:00Z</dcterms:created></cp:coreProperties>',
      },
    )
    expect(output.text).toBe('[REDACTED] in 2024')
    expect(output.xml).toContain('w:val="24"')
  })
  it.each([
    ['1 High Street\nLondon', t('1 High Street') + '<w:br/>' + t('London')],
    ['Smith‑Jones', t('Smith') + '<w:noBreakHyphen/>' + t('Jones')],
    ['Smith\u00adJones', t('Smith') + '<w:softHyphen/>' + t('Jones')],
    [
      'SmithαJones',
      t('Smith') + '<w:sym w:font="Symbol" w:char="F061"/>' + t('Jones'),
    ],
  ])('burns extracted characters in %j', async (name, xml) => {
    const output = await burn(p(xml), [name])
    expect(output.text).toBe('[REDACTED]')
    expect(output.xml).not.toContain('Smith')
    expect(output.xml).not.toContain('London')
    expect(output.xml).not.toContain('w:sym')
    expect(output.xml).not.toContain('w:noBreakHyphen')
    expect(output.xml).not.toContain('w:softHyphen')
  })
  it('burns a signature selection crossing an empty paragraph', async () => {
    const output = await burn(p(t('Jane Doe')) + '<w:p/>' + p(t('Solicitor')), [
      'Jane Doe\n\n\n\nSolicitor',
    ])
    expect(output.xml).not.toContain('Jane')
    expect(output.xml).not.toContain('Solicitor')
    expect(output.xml).toContain('<w:p/>')
  })
  it.each([false, true])(
    'supports a real Word shape with an inside selection: %j',
    async (inside) => {
      const output = await burn(
        p(t('Jane Doe')) + textBox('Private address'),
        inside ? ['Jane Doe', 'Private address'] : ['Jane Doe'],
      )
      expect(output.xml).not.toContain('Jane Doe')
      expect(output.xml).not.toContain('mc:Fallback')
      expect(output.xml).toContain('w:drawing')
      if (inside) expect(output.xml).not.toContain('Private address')
      else expect(output.xml).toContain('Private address')
    },
  )
  it('scrubs accepted names from nearby picture descriptions and filenames only', async () => {
    const drawing =
      '<w:drawing><wp:docPr xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" id="1" name="Picture" descr="Photo of Jane Doe" title="Other title"/><pic:cNvPr xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" id="2" name="jane_doe.jpg" descr="Jane Doe portrait"/></w:drawing>'
    const output = await burn(p(t('Jane Doe')) + p(drawing), ['Jane Doe'])
    expect(output.xml).not.toContain('Jane Doe')
    expect(output.xml).not.toContain('jane_doe')
    expect(output.xml).toContain('Photo of [REDACTED]')
    expect(output.xml).toContain('title="Other title"')
    expect(output.xml).toContain('[REDACTED].jpg')
  })
  it('redacts one TOC entry while keeping neighbouring entries and their instructions', async () => {
    const begin = '<w:fldChar w:fldCharType="begin"/>'
    const separate = '<w:fldChar w:fldCharType="separate"/>'
    const end = '<w:fldChar w:fldCharType="end"/>'
    const field = (instruction: string, result: string) =>
      r(
        begin +
          `<w:instrText>${instruction}</w:instrText>` +
          separate +
          t(result) +
          end,
      )
    const output = await burn(
      `<w:p>${r(begin + '<w:instrText>TOC \\o "1-3"</w:instrText>' + separate)}${field('HYPERLINK "private"', 'Jane Doe')}${field('PAGEREF _Toc2', 'Other entry')}${r(end)}</w:p>`,
      ['Jane Doe'],
    )
    expect(output.xml).not.toContain('HYPERLINK "private"')
    expect(output.xml).toContain('TOC \\o "1-3"')
    expect(output.xml).toContain('PAGEREF _Toc2')
    expect(output.text).toBe('[REDACTED]Other entry')
  })
  it('refuses a name inside an embedded compressed xlsx and names the part', async () => {
    const nested = new JSZip()
    nested.file('xl/sharedStrings.xml', '<sst><si><t>Jane Doe</t></si></sst>')
    const xlsx = await nested.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
    })
    await expect(
      burn(p(t('Jane Doe')), ['Jane Doe'], {
        'word/embeddings/private.xlsx': xlsx,
      }),
    ).rejects.toThrow('word/embeddings/private.xlsx!/xl/sharedStrings.xml')
  })
  it('refuses accepted UTF-16LE text in a binary object', async () => {
    await expect(
      burn(p(t('Jane Doe')), ['Jane Doe'], {
        'word/embeddings/oleObject1.bin': Buffer.from('Jane Doe', 'utf16le'),
      }),
    ).rejects.toThrow('word/embeddings/oleObject1.bin')
  })
  it('refuses accepted text in a percent-encoded relationship target', async () => {
    await expect(
      burn(p(t('Jane Doe')), ['Jane Doe'], {
        'word/_rels/unrelated.xml.rels':
          '<Relationships><Relationship Target="https://example.invalid/Jane%20Doe"/></Relationships>',
      }),
    ).rejects.toThrow('word/_rels/unrelated.xml.rels')
  })
  it('places marker colour and highlight before w14 extension properties', async () => {
    const output = await burn(
      p(
        '<w:rPr><w:b/><w14:ligatures xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:val="standard"/></w:rPr>' +
          t('Jane Doe'),
      ),
      ['Jane Doe'],
    )
    const elements = parseXmlElements(output.xml)
    const marker = elements.find((element) =>
      isWord(element, 'highlight'),
    )?.parent
    expect(marker).toBeDefined()
    expect(
      elements
        .filter((element) => element.parent === marker)
        .map((element) => element.localName),
    ).toEqual(['b', 'color', 'highlight', 'ligatures'])
  })
  it('burns selected comment and deletion text while preserving other review text', async () => {
    const output = await burn(
      p(t('Public')) +
        '<w:p><w:del w:id="1" w:author="Reviewer">' +
        r('<w:delText>Jane Doe</w:delText>') +
        '</w:del></w:p>',
      ['Jane Doe', 'Other review note'],
      {
        'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer">${p(t('Other review note'))}${p(t('Keep this note'))}</w:comment></w:comments>`,
      },
    )
    expect(output.xml).not.toContain('Jane Doe')
    expect(output.xml).toContain(
      '<w:delText xml:space="preserve">[REDACTED]</w:delText>',
    )
    expect(output.text).not.toContain('Other review note')
    expect(output.text).toContain('Keep this note')
  })
  it('scrubs accepted identities from comment and revision authors without changing other authors', async () => {
    const output = await burn(
      p(t('Jane Doe')) +
        '<w:p><w:ins w:id="1" w:author="Jane Doe">' +
        r(t('Public addition')) +
        '</w:ins></w:p>',
      ['Jane Doe'],
      {
        'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Jane Doe">${p(t('Review note'))}</w:comment><w:comment w:id="1" w:author="Reviewer">${p(t('Other note'))}</w:comment></w:comments>`,
      },
    )
    expect(output.comments).not.toContain('Jane Doe')
    expect(output.comments).toContain('w:author="Reviewer"')
    expect(output.xml).not.toContain('Jane Doe')
    expect(output.text).toContain('Public addition')
    expect(output.text).toContain('Review note')
  })
  it('refuses an unsupported symbol instead of silently dropping its character', async () => {
    const bytes = await source(
      p(t('Public ') + '<w:sym w:font="Unknown Custom Font" w:char="F0FF"/>'),
    )
    await expect(extractDocumentText('docx', bytes)).rejects.toThrow(
      'unsupported font or character',
    )
  })
  it('burns XML character data without changing surrounding visible characters', async () => {
    const output = await burn(p('<w:t>Dear <![CDATA[Jane Doe]]>,</w:t>'), [
      'Jane Doe',
    ])
    expect(output.text).toBe('Dear [REDACTED],')
  })
  it.each([
    '<w:t xmlns:x="urn:private" x:hint="Jane Doe">Public</w:t>',
    '<w:rPr><w:sz xmlns:x="urn:private" w:val="24" x:hint="Jane Doe"/></w:rPr><w:t>Public</w:t>',
    '<!-- Jane Doe -->' + t('Public'),
    '<w:t>Public<!-- Jane Doe --></w:t>',
  ])(
    'refuses hidden accepted text outside mapped character data: %s',
    async (hidden) => {
      await expect(
        burn(p(t('Jane Doe')) + p(hidden), ['Jane Doe']),
      ).rejects.toThrow('survives in word/document.xml')
    },
  )
  it('refuses legacy coordinates that cannot be mapped exactly', async () => {
    const docxBytes = await source(p(t('Jane') + '<w:br/>' + t('Doe')))
    await expect(
      buildRedactedDocx({
        docxBytes,
        text: 'JaneDoe',
        spans: [],
        decisions: {},
        outputMode: 'redacted',
        tokenMap: {},
      }),
    ).rejects.toThrow('create a new redaction run')
  })
})
