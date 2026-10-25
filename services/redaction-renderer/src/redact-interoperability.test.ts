import { afterAll, beforeAll, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { extractText, getDocumentProxy } from 'unpdf'
import { createSyntheticDocx } from '@obiter/ooxml'
import { extractRedactionContent } from '../../api/src/redaction-extraction'
import { buildRedactedDocx } from '../../api/src/redaction-docx-output'
import { loadRendererAssets } from './assets'
import { createDocxRenderer, type DocxRenderer } from './renderer'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const t = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`
const p = (value: string) => `<w:p>${t(value)}</w:p>`
const field = (instruction: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${instruction}</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`
const fixtures = [
  [
    'hyperlink field',
    `<w:p>${field('HYPERLINK &quot;mailto:private@example.invalid&quot;', field('MERGEFIELD Name', t('Jane Doe')))}</w:p>`,
  ],
  [
    'text box',
    `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${p('Jane Doe')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`,
  ],
  [
    'TOC',
    `<w:p>${field('TOC \\o &quot;1-3&quot;', field('HYPERLINK private', t('Jane Doe')) + field('PAGEREF _Toc2', t('Other entry')))}</w:p>`,
  ],
  [
    'tracked changes and comments',
    `<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Jane Doe</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer">${t('Public replacement')}</w:ins></w:p>`,
  ],
  [
    'w14 run properties',
    `<w:p><w:r><w:rPr><w:b/><w14:ligatures xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:val="standard"/></w:rPr><w:t>Jane Doe</w:t></w:r></w:p>`,
  ],
  ['multi-paragraph header', p('Public body')],
] as const
let renderer: DocxRenderer
beforeAll(async () => {
  renderer = await createDocxRenderer({ assets: await loadRendererAssets() })
})
afterAll(async () => {
  await renderer?.close()
})
it.each(fixtures)(
  'renders burned %s DOCX through the sandboxed renderer without the accepted text',
  async (name, body) => {
    const zip = await JSZip.loadAsync(await createSyntheticDocx(['fixture']))
    const sect =
      name === 'multi-paragraph header'
        ? '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>'
        : ''
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}"><w:body>${body}${p('Public concluding paragraph')}${sect}</w:body></w:document>`,
    )
    if (name === 'multi-paragraph header') {
      zip.file(
        'word/header1.xml',
        `<w:hdr xmlns:w="${W}">${p('Jane Doe')}${p('Ordinary Solicitors LLP')}</w:hdr>`,
      )
      zip.file(
        'word/_rels/document.xml.rels',
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="${R}/header" Target="header1.xml"/></Relationships>`,
      )
    }
    if (name === 'tracked changes and comments')
      zip.file(
        'word/comments.xml',
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer">${p('Jane Doe reviewed this')}${p('Public review note')}</w:comment></w:comments>`,
      )
    const docxBytes = Buffer.from(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const { text } = await extractRedactionContent('docx', docxBytes)
    const start = text.indexOf('Jane Doe')
    expect(start).toBeGreaterThanOrEqual(0)
    const output = await buildRedactedDocx({
      docxBytes,
      text,
      spans: [
        {
          id: 'accepted',
          text: 'Jane Doe',
          start,
          end: start + 8,
          category: 'person_name',
          source: 'rampart_model',
          confidence: 'high',
          suggestion: 'redact',
        },
      ],
      decisions: {
        accepted: {
          decision: 'accept',
          decidedBy: 'test',
          decidedAt: '2026-01-01T00:00:00Z',
        },
      },
      outputMode: 'redacted',
      tokenMap: {},
    })
    // The burned package the hard-PDF path hands over must render, and the
    // rendered page must carry the untouched text but not the accepted name.
    const pdf = await renderer.render(output)
    const { text: rendered } = await extractText(
      await getDocumentProxy(new Uint8Array(pdf)),
      { mergePages: true },
    )
    expect(rendered).toContain('Public concluding paragraph')
    expect(rendered).not.toContain('Jane Doe')
  },
  30_000,
)
