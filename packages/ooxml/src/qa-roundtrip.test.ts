import { expect, it } from 'bun:test'
import JSZip from 'jszip'

import { buildOoxmlFixture } from '../fixtures/builder'
import { ooxmlFixtureManifest } from '../fixtures/manifest'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { escapeXmlText } from './parts/overlay'

for (const { name } of ooxmlFixtureManifest) {
  it(`keeps every unrelated package byte across Unicode edits: ${name}`, async () => {
    const source = await JSZip.loadAsync(await buildOoxmlFixture(name))
    const originalXml = await source.file('word/document.xml')?.async('string')
    if (!originalXml) throw new Error('Missing fixture document')
    const probe =
      '<w:p><w:r><w:t>QA first</w:t><w:cr/><w:t>QA second</w:t></w:r></w:p>'
    source.file(
      'word/document.xml',
      originalXml.replace('<w:body>', `<w:body>${probe}`),
    )
    const document = await parseDocx(
      await source.generateAsync({ type: 'uint8array' }),
    )
    const run = document.model.stories.find(
      (story) => story.kind === 'document',
    )?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Missing probe run')
    expect(run.text).toBe('QA first\nQA second')
    const text = 'Cymru é — العربية 😀 < & >'
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text },
    ])
    const bytes = await serialiseDocx(document)
    const output = await JSZip.loadAsync(bytes)
    expect(Object.keys(output.files).sort()).toEqual(
      Object.keys(source.files).sort(),
    )
    for (const [name, part] of Object.entries(source.files)) {
      if (part.dir || name === 'word/document.xml') continue
      expect(await output.file(name)?.async('uint8array')).toEqual(
        await part.async('uint8array'),
      )
    }
    const expectedProbe = `<w:p><w:r><w:t>${escapeXmlText(text)}</w:t><w:t></w:t></w:r></w:p>`
    expect(await output.file('word/document.xml')?.async('string')).toBe(
      originalXml.replace('<w:body>', `<w:body>${expectedProbe}`),
    )
    const reopened = await parseDocx(bytes)
    expect(
      reopened.model.stories.find((story) => story.kind === 'document')
        ?.paragraphs[0]?.runs[0]?.text,
    ).toBe(text)
  })
}
