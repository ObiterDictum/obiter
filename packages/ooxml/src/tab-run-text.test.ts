import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

const WORDPROCESSINGML_DOCUMENT =
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>%CHILDREN%</w:r></w:p></w:body></w:document>'

async function parseRun(children: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    WORDPROCESSINGML_DOCUMENT.replace('%CHILDREN%', children),
  )
  const document = await parseDocx(
    await zip.generateAsync({ type: 'uint8array' }),
  )
  const paragraph = mainParagraphs(document)[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Fixture run is missing.')
  return { document, paragraph, run }
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}

describe('a tab in run text', () => {
  it('writes a replacement tab as a tab element between the text elements', async () => {
    const { document, run } = await parseRun('<w:t>ab</w:t>')
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'a\tb' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r>')
    expect(xml).not.toContain('>a\tb<')
    expect(mainParagraphs(await parseDocx(output))[0]?.runs[0]?.text).toBe(
      'a\tb',
    )
  })

  it('reads a stored tab element as a tab character in the run text', async () => {
    const { run } = await parseRun('<w:t>a</w:t><w:tab/><w:t>b</w:t>')
    expect(run.text).toBe('a\tb')
    expect(run.preservedXmlFragments.join('')).not.toContain('<w:tab/>')
  })

  it('keeps a stored tab element when the text is rewritten around it', async () => {
    const { document, run } = await parseRun('<w:t>a</w:t><w:tab/><w:t>b</w:t>')
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'a\tc' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml.match(/<w:tab\/>/gu)).toHaveLength(1)
    expect(mainParagraphs(await parseDocx(output))[0]?.runs[0]?.text).toBe(
      'a\tc',
    )
  })

  it('drops a tab when the replacement text no longer has one', async () => {
    const { document, run } = await parseRun('<w:t>a</w:t><w:tab/><w:t>b</w:t>')
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'ab' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).not.toContain('<w:tab/>')
    expect(mainParagraphs(await parseDocx(output))[0]?.runs[0]?.text).toBe('ab')
  })

  it('drops a tab the new text replaces with a newline', async () => {
    const { document, run } = await parseRun(
      '<w:t>First</w:t><w:tab/><w:t>Second</w:t>',
    )
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'First\nSecond' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).not.toContain('<w:tab/>')
    expect(xml).toContain('<w:t>First</w:t><w:br/><w:t>Second</w:t>')
  })

  it('reads the default tab stop from the settings part', async () => {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.file(
      'word/settings.xml',
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="1440"/></w:settings>',
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    expect(document.model.defaultTabStopTwips).toBe(1440)
  })

  it('writes a tab inserted under track changes as an inserted tab element', async () => {
    const { document, run } = await parseRun('<w:t>ab</w:t>')
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: run.id, text: 'a\tbc' }],
      { author: 'Synthetic Reviewer', date: '2026-01-01T00:00:00.000Z' },
    )
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<w:ins ')
    expect(xml).toContain('<w:tab/>')
    expect(xml).not.toContain('>\t<')
    const reread = await parseDocx(output)
    expect(reread.model.changes.map((change) => change.text)).toContain('a\tbc')
  })
})
