import { scrubBurnedFields } from './redaction-docx-burn'
import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createSyntheticDocx, parseDocx, parseXmlElements, attributeValue } from '@obiter/ooxml'
import {
  buildRedactedDocx,
  RedactionDocxBurnError,
} from './redaction-docx-output'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const target = 'mailto:private@example.invalid'
const begin = '<w:fldChar w:fldCharType="begin"/>'
const separate = '<w:fldChar w:fldCharType="separate"/>'
const end = '<w:fldChar w:fldCharType="end"/>'
const instruction = `<w:instrText>HYPERLINK &quot;${target}&quot;</w:instrText>`
const run = (xml: string) => `<w:r>${xml}</w:r>`

async function burn(
  body: string,
  text = 'Jane Doe',
  names = [text],
  extraParts: Record<string, string> = {},
  outputMode: 'redacted' | 'pseudonymised' = 'pseudonymised',
) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`,
  )
  if (!body.includes('r:id="link"')) zip.remove('word/_rels/document.xml.rels')
  for (const [name, value] of Object.entries(extraParts)) zip.file(name, value)
  const spans = names.map((name, i) => ({
    id: `s${i}`,
    start: text.indexOf(name),
    end: text.indexOf(name) + name.length,
    text: name,
    category: 'person_name' as const,
    source: 'rampart_model' as const,
    confidence: 'high' as const,
    suggestion: 'redact' as const,
  }))
  const output = await buildRedactedDocx({
    docxBytes: Buffer.from(await zip.generateAsync({ type: 'uint8array' })),
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
    outputMode,
    tokenMap: Object.fromEntries(
      names.map((name, i) => [`PERSON_NAME_${i + 1}`, name]),
    ),
  })
  const parsed = await parseDocx(output)
  const packageZip = await JSZip.loadAsync(output)
  const xml =
    (await packageZip.file('word/document.xml')?.async('string')) ?? ''
  const rels =
    (await packageZip.file('word/_rels/document.xml.rels')?.async('string')) ??
    ''
  const ids = new Set(rels ? parseXmlElements(rels).filter((element) => element.localName === 'Relationship').map((element) => attributeValue(element, '', 'Id')) : [])
  for (const element of parseXmlElements(xml)) {
    for (const attribute of element.attributes) {
      if (attribute.namespaceUri === R) expect(ids.has(attribute.value), `unresolved ${attribute.qualifiedName}`).toBe(true)
    }
  }
  return {
    xml,
    rels,
    text: parsed.model.stories
      .flatMap((story) =>
        story.paragraphs.map((p) => p.runs.map((r) => r.text).join('')),
      )
      .join('\n'),
  }
}

describe('Redact-owned DOCX bytes', () => {
  it('refuses to return bytes when accepted text survives in an opaque package part', async () => {
    await expect(
      burn(
        `<w:p>${run('<w:t>Jane Doe</w:t>')}</w:p>`,
        'Jane Doe',
        ['Jane Doe'],
        { 'private.bin': 'Jane Doe' },
      ),
    ).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })

  it.each([
    ['Jane\tDoe', '<w:t>Jane</w:t><w:tab/><w:t>Doe</w:t>'],
    ['Jane\nDoe', '<w:t>Jane</w:t><w:br w:type="page"/><w:t>Doe</w:t>'],
  ])('burns extraction characters in %j', async (text, nodes) => {
    const output = await burn(`<w:p>${run(nodes)}</w:p>`, text)
    expect(output.text).toBe('[PERSON_NAME_1]')
    expect(output.xml).not.toContain('Jane')
    expect(output.xml).not.toContain('Doe')
  })

  it('burns every paragraph piece of an accepted address', async () => {
    const output = await burn('<w:p>' + run('<w:t>1 High St</w:t>') + '</w:p><w:p>' + run('<w:t>London</w:t>') + '</w:p>', '1 High St\nLondon')
    expect(output.xml).not.toContain('High St')
    expect(output.xml).not.toContain('London')
    expect(output.text).toContain('[PERSON_NAME_1]')
  })

  it('refuses an accepted span absent from all burnable text', async () => {
    await expect(burn('<w:p>' + run('<w:t>Public</w:t>') + '</w:p>', 'Jane\tDoe')).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })

  it('covers the union of overlapping pseudonyms with the first token', async () => {
    const output = await burn('<w:p>' + run('<w:t>Jane Doe Smith</w:t>') + '</w:p>', 'Jane Doe Smith', ['Jane Doe', 'Doe Smith'])
    expect(output.text).toBe('[PERSON_NAME_1]')
  })

  it.each([
    '<root><p><t>Jane </t><t>Doe</t></p></root>',
    '<root><p>Smith &amp; Co</p></root>',
  ])('refuses decoded residual XML %s', async (xml) => {
    const name = xml.includes('Smith') ? 'Smith & Co' : 'Jane Doe'
    await expect(burn('<w:p>' + run('<w:t>' + name.replace('&', '&amp;') + '</w:t>') + '</w:p>', name, [name], { 'customXml/private.xml': xml })).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })

  it('removes a split-run fallback text-box copy', async () => {
    const output = await burn('<w:p>' + run('<w:t>Jane Doe</w:t>') + '</w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w"><w:p>' + run('<w:t>Public</w:t>') + '</w:p></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p>' + run('<w:t>Jane </w:t>') + run('<w:t>Doe</w:t>') + '</w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent>')
    expect(output.xml).not.toContain('Jane')
    expect(output.xml).not.toContain('Doe')
    expect(output.xml).not.toContain('mc:Fallback')
  })

  it('clears redacted hyperlink tooltip and document location', async () => {
    const output = await burn('<w:p><w:hyperlink r:id="link" w:tooltip="private hint" w:docLocation="private location">' + run('<w:t>Jane Doe</w:t>') + '</w:hyperlink></w:p>')
    expect(output.xml).not.toContain('private hint')
    expect(output.xml).not.toContain('private location')
  })

  it('clears image alt text and title within a redacted range', async () => {
    const output = await burn('<w:p>' + run('<w:t>Jane </w:t><w:drawing><wp:docPr xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" id="1" name="Picture" descr="private description" title="private title"/></w:drawing><w:t>Doe</w:t>') + '</w:p>')
    expect(output.xml).not.toContain('private description')
    expect(output.xml).not.toContain('private title')
  })

  it('refuses a redacted hyperlink when its relationship XML has no overlay', async () => {
    const zip = await JSZip.loadAsync(await createSyntheticDocx(['Jane Doe']))
    zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:hyperlink r:id="link">${run('<w:t>Jane Doe</w:t>')}</w:hyperlink></w:p></w:body></w:document>`)
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="' + R + '/hyperlink" Target="' + target + '" TargetMode="External"/></Relationships>')
    const document = await parseDocx(await zip.generateAsync({ type: 'uint8array' }))
    const rels = document.sourceParts.get('word/_rels/document.xml.rels')
    if (!rels) throw new Error('missing test relationship')
    delete rels.overlay
    expect(() => scrubBurnedFields(document, new Map([['word/document.xml', [{ start: 0, end: 100000 }]]]))).toThrow(RedactionDocxBurnError)
  })

  it('styles the marker in its own rPr in schema order before rPrChange', async () => {
    const output = await burn('<w:p>' + run('<w:rPr><w:b/><w:lang w:val="en-GB"/><w:rPrChange w:id="1" w:author="Synthetic"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Jane Doe</w:t>') + '</w:p>', 'Jane Doe', ['Jane Doe'], {}, 'redacted')
    expect(output.xml).toContain('<w:b/><w:color w:val="000000"/><w:highlight w:val="black"/><w:lang')
    expect(output.xml).not.toContain('<w:i/><w:highlight')
    expect(output.text).toBe('[REDACTED]')
  })

  it('burns AlternateContent inside a run without unbalancing its XML', async () => {
    const output = await burn('<w:p>' + run('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w"><w:t>Jane Doe</w:t></mc:Choice><mc:Fallback><w:t>Jane Doe</w:t></mc:Fallback></mc:AlternateContent>') + '</w:p>')
    expect(output.text).toBe('[PERSON_NAME_1]')
    expect(output.xml).not.toContain('Jane')
  })

  it('maps a Unicode burn failure to the structured refusal', async () => {
    await expect(burn('<w:p>' + run('<w:t>😀</w:t>') + '</w:p>', '😀', ['\ud83d'])).rejects.toBeInstanceOf(RedactionDocxBurnError)
  })

  it('neutralises a drawing hyperlink sharing a redacted hyperlink relationship', async () => {
    const output = await burn('<w:p><w:hyperlink r:id="link">' + run('<w:t>Jane Doe</w:t>') + '</w:hyperlink>' + run('<w:drawing><a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="link"/></w:drawing>') + '</w:p>')
    expect(output.xml).not.toContain('r:id="link"')
    expect(output.rels).not.toContain(target)
  })

  it('empties hidden hyperlink instructions inside the redacted range and keeps fields balanced', async () => {
    const output = await burn(
      `<w:p>${run(begin + '<w:t>Jane</w:t>' + instruction + separate + '<w:t> Doe</w:t>' + end)}</w:p>`,
    )
    expect(output.xml).not.toContain(target)
    expect(output.rels).not.toContain(target)
    expect(output.xml).not.toContain('Jane')
    expect(output.xml).not.toContain('Doe')
    for (const marker of [begin, separate, end])
      expect(output.xml).toContain(marker)
    expect(output.text).toBe('[PERSON_NAME_1]')
  })

  it('empties an instruction outside the span when only part of its result is redacted', async () => {
    const output = await burn(
      `<w:p>${run(begin + instruction + separate)}${run('<w:t>Dear Jane Doe, welcome</w:t>')}${run(end)}</w:p>`,
      'Dear Jane Doe, welcome',
      ['Jane Doe'],
    )
    expect(output.xml).not.toContain(target)
    expect(output.rels).not.toContain(target)
    expect(output.xml).toContain('<w:instrText></w:instrText>')
    expect(output.text).toBe('Dear [PERSON_NAME_1], welcome')
    for (const marker of [begin, separate, end])
      expect(output.xml).toContain(marker)
  })

  it('empties simple-field instructions while preserving an unrelated field', async () => {
    const output = await burn(
      `<w:p><w:fldSimple w:instr='HYPERLINK "${target}"'>${run('<w:t>Jane Doe</w:t>')}</w:fldSimple><w:fldSimple w:instr="DATE">${run('<w:t>today</w:t>')}</w:fldSimple></w:p>`,
      'Jane Doe today',
      ['Jane Doe'],
    )
    expect(output.xml).not.toContain(target)
    expect(output.xml).toContain('w:instr=""')
    expect(output.xml).toContain('w:instr="DATE"')
    expect(output.text).toBe('[PERSON_NAME_1]today')
  })

  it('removes external hyperlink targets and their references, preserving surrounding text', async () => {
    const output = await burn(
      `<w:p><w:hyperlink r:id="link">${run('<w:t>Dear Jane Doe</w:t>')}</w:hyperlink></w:p>`,
      'Dear Jane Doe',
      ['Jane Doe'],
    )
    expect(output.rels).not.toContain(target)
    expect(output.xml).not.toContain('r:id="link"')
    expect(output.text).toBe('Dear [PERSON_NAME_1]')
  })

  it('preserves tabs, breaks, field markers and footnote references at both range edges', async () => {
    const left =
      '<w:tab/><w:br/><w:footnoteReference w:id="1"/>' + begin + separate
    const right = end + '<w:footnoteReference w:id="2"/><w:br/><w:tab/>'
    const output = await burn(
      `<w:p>${run(left + '<w:t>Jane Doe</w:t>' + right)}</w:p>`,
      '\nJane Doe\n',
      ['Jane Doe'],
    )
    expect(output.xml).toContain(left)
    expect(output.xml).toContain(right)
    expect(output.text).toBe('\n[PERSON_NAME_1]\n')
  })

  it('keeps adjacent redactions distinct across runs and XML entities', async () => {
    const output = await burn(
      `<w:p>${run('<w:t>Jane&amp;</w:t>')}${run('<w:t>Doe</w:t>')}</w:p>`,
      'Jane&Doe',
      ['Jane&', 'Doe'],
    )
    expect(output.text).toBe('[PERSON_NAME_1][PERSON_NAME_2]')
    expect(output.xml).not.toContain('Jane')
    expect(output.xml).not.toContain('Doe')
  })
})
