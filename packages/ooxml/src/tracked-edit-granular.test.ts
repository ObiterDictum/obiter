import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  serialiseDocx,
  writeTrackRevisions,
} from './index'

const changeContext = {
  author: 'Review & Author',
  date: '2026-08-11T12:30:00.000Z',
}

/**
 * A document whose first paragraph holds a single plain run of `text`; extra
 * body markup follows in later paragraphs. The run's children stay `w:rPr` +
 * `w:t`, the splittable shape.
 */
async function runFixture(runXml: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${runXml}</w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'uint8array' })
}

async function editAndParse(runXml: string, text: string, oldText?: string) {
  const document = await parseDocx(await runFixture(runXml))
  const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
  if (!run) throw new Error('Fixture run is missing.')
  if (oldText !== undefined && run.text !== oldText) {
    throw new Error(`Fixture run text was ${run.text}, wanted ${oldText}.`)
  }
  applyDocumentEdits(
    document,
    [{ type: 'replace_run_text', runId: run.id, text }],
    changeContext,
  )
  const output = await serialiseDocx(document)
  const xml = await zipText(output, 'word/document.xml')
  const reparsed = await parseDocx(output)
  return { document, xml, reparsed }
}

async function zipText(bytes: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(partName)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}

describe('granular tracked text edits', () => {
  const SENTENCE =
    '4.2 The Buyer shall order, and the Supplier shall supply, not less than 60,000 units of the Products in each calendar month during the Term.'

  it('records only the changed token in the middle of a run', async () => {
    const { xml, reparsed } = await editAndParse(
      `<w:r><w:t>${SENTENCE}</w:t></w:r>`,
      SENTENCE.replace('60,000', '50,000'),
      SENTENCE,
    )
    expect(xml).toContain('<w:delText>60,000</w:delText>')
    expect(xml).toContain('>50,000</w:t>')
    expect(xml).not.toContain(`<w:delText>${SENTENCE}</w:delText>`)
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(
      generated.map(({ elementName, text }) => [elementName, text]),
    ).toEqual([
      ['del', '60,000'],
      ['ins', '50,000'],
    ])
    // The kept runs parse as untracked siblings; the pending insertion stays
    // out of the visible model the way every tracked insertion does.
    const paragraph = reparsed.model.stories[0]?.paragraphs[0]
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      SENTENCE.replace('60,000', ''),
    )
  })

  it('records a substitution at the start of a run', async () => {
    const { xml, reparsed } = await editAndParse(
      '<w:r><w:t>First word stays</w:t></w:r>',
      'Last word stays',
      'First word stays',
    )
    expect(xml).toContain('<w:delText>First</w:delText>')
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(
      generated.map(({ elementName, text }) => [elementName, text]),
    ).toEqual([
      ['del', 'First'],
      ['ins', 'Last'],
    ])
  })

  it('records a substitution at the end of a run', async () => {
    const { xml, reparsed } = await editAndParse(
      '<w:r><w:t>stays same end</w:t></w:r>',
      'stays same stop',
      'stays same end',
    )
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(
      generated.map(({ elementName, text }) => [elementName, text]),
    ).toEqual([
      ['del', 'end'],
      ['ins', 'stop'],
    ])
    expect(xml).toContain('<w:t xml:space="preserve">stays same </w:t>')
  })

  it('records a pure insertion as only w:ins', async () => {
    const { xml, reparsed } = await editAndParse(
      '<w:r><w:t>the cat sat</w:t></w:r>',
      'the cats sat',
      'the cat sat',
    )
    expect(xml).not.toContain('<w:del ')
    expect(xml).not.toContain('delText')
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(generated.map(({ elementName }) => elementName)).toEqual(['ins'])
    expect(generated[0]?.text).toBe('s')
  })

  it('records a pure deletion as only w:del', async () => {
    const { xml, reparsed } = await editAndParse(
      '<w:r><w:t>the cats sat</w:t></w:r>',
      'the cat sat',
      'the cats sat',
    )
    expect(xml).not.toContain('<w:ins ')
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(generated.map(({ elementName }) => elementName)).toEqual(['del'])
    expect(generated[0]?.text).toBe('s')
  })

  it('emits nothing for a no-op replacement', async () => {
    const document = await parseDocx(
      await runFixture('<w:r><w:t>unchanged</w:t></w:r>'),
    )
    const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: run.id, text: 'unchanged' }],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).not.toContain('<w:ins')
    expect(xml).not.toContain('<w:del ')
    expect(xml).toContain('<w:t>unchanged</w:t>')
  })

  it('never splits a surrogate pair at the diff boundary', async () => {
    const { reparsed } = await editAndParse(
      '<w:r><w:t>flat \u{1D11E} sign</w:t></w:r>',
      'flat \u{1D122} sign',
      'flat \u{1D11E} sign',
    )
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(
      generated.map(({ elementName, text }) => [elementName, text]),
    ).toEqual([
      ['del', '\u{1D11E}'],
      ['ins', '\u{1D122}'],
    ])
  })

  it('keeps run properties on every emitted piece', async () => {
    const { xml } = await editAndParse(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>one two three</w:t></w:r>',
      'one four three',
      'one two three',
    )
    const delPiece = xml.match(/<w:del [^>]*>[\s\S]*?<\/w:del>/u)?.[0]
    const insPiece = xml.match(/<w:ins [^>]*>[\s\S]*?<\/w:ins>/u)?.[0]
    expect(delPiece).toContain('<w:rPr><w:b/></w:rPr>')
    expect(insPiece).toContain('<w:rPr><w:b/></w:rPr>')
    expect(delPiece).toContain('<w:delText>two</w:delText>')
    expect(insPiece).toContain('<w:t>four</w:t>')
  })

  it('folds a pending property change into the inserted run', async () => {
    const document = await parseDocx(
      await runFixture('<w:r><w:t>one two three</w:t></w:r>'),
    )
    const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')
    applyDocumentEdits(
      document,
      [
        { type: 'set_run_emphasis', runId: run.id, bold: true },
        { type: 'replace_run_text', runId: run.id, text: 'one four three' },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const insPiece = xml.match(/<w:ins [^>]*>[\s\S]*?<\/w:ins>/u)?.[0]
    expect(insPiece).toContain('<w:rPrChange')
    expect(insPiece).toContain('<w:t>four</w:t>')
    const delPiece = xml.match(/<w:del [^>]*>[\s\S]*?<\/w:del>/u)?.[0]
    expect(delPiece).not.toContain('rPrChange')
  })

  it('folds a pending property change into the deleted run of a pure deletion', async () => {
    const document = await parseDocx(
      await runFixture('<w:r><w:t>the cats sat</w:t></w:r>'),
    )
    const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')
    applyDocumentEdits(
      document,
      [
        { type: 'set_run_emphasis', runId: run.id, bold: true },
        { type: 'replace_run_text', runId: run.id, text: 'the cat sat' },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const delPiece = xml.match(/<w:del [^>]*>[\s\S]*?<\/w:del>/u)?.[0]
    expect(delPiece).toContain('<w:rPrChange')
    expect(delPiece).toContain('<w:delText>s</w:delText>')
    expect(xml).not.toContain('<w:ins ')
  })

  it('falls back to the whole-run form for a run with non-text children', async () => {
    const { xml } = await editAndParse(
      '<w:r><w:t>keep tab</w:t><w:tab/><w:t>here</w:t></w:r>',
      'keep tab gone here',
      'keep tabhere',
    )
    expect(xml).not.toContain('<w:delText>tab</w:delText>')
    expect(xml).toContain('<w:delText>keep tab</w:delText>')
  })

  it('falls back to the whole-run form for a run with a break', async () => {
    const document = await parseDocx(
      await runFixture('<w:r><w:t>line</w:t><w:br/><w:t>two</w:t></w:r>'),
    )
    const run = document.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: run.id, text: 'line\nthree' }],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:delText>line</w:delText>')
    expect(xml).toContain('<w:delText>two</w:delText>')
  })

  it('accepts and rejects the granular change restoring the right text', async () => {
    const edited = await editAndParse(
      '<w:r><w:t>the 60,000 units</w:t></w:r>',
      'the 50,000 units',
      'the 60,000 units',
    )
    const changes = edited.reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    const del = changes.find(({ elementName }) => elementName === 'del')
    const ins = changes.find(({ elementName }) => elementName === 'ins')
    if (!del || !ins) throw new Error('Granular change pair is missing.')

    const rejected = await parseDocx(
      await runFixture('<w:r><w:t>the 60,000 units</w:t></w:r>'),
    )
    // Reject both halves on the edited document: the paragraph reads the
    // original text again.
    applyTrackedChangeDecisions(edited.reparsed, [del.id, ins.id], 'reject')
    const rejectedXml = await zipText(
      await serialiseDocx(edited.reparsed),
      'word/document.xml',
    )
    expect(rejectedXml).toContain('60,000')
    expect(rejectedXml).not.toContain('50,000')
    void rejected

    const acceptedSource = await parseDocx(
      await runFixture('<w:r><w:t>the 60,000 units</w:t></w:r>'),
    )
    const acceptedRun = acceptedSource.model.stories[0]?.paragraphs[0]?.runs[0]
    if (!acceptedRun) throw new Error('Fixture run is missing.')
    applyDocumentEdits(
      acceptedSource,
      [
        {
          type: 'replace_run_text',
          runId: acceptedRun.id,
          text: 'the 50,000 units',
        },
      ],
      changeContext,
    )
    const accepted = await parseDocx(await serialiseDocx(acceptedSource))
    applyTrackedChangeDecisions(
      accepted,
      accepted.model.changes.map(({ id }) => id),
      'accept',
    )
    const acceptedXml = await zipText(
      await serialiseDocx(accepted),
      'word/document.xml',
    )
    expect(acceptedXml).toContain('50,000')
    expect(acceptedXml).not.toContain('60,000')
    expect(acceptedXml).not.toContain('delText')
  })
})

describe('trackRevisions settings persistence', () => {
  it('reads the toggle from the settings part at parse', async () => {
    const tracked = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    expect(tracked.model.trackRevisions).toBe(true)

    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.remove('word/settings.xml')
    const untracked = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    expect(untracked.model.trackRevisions).toBe(false)
  })

  it('reads an explicit w:val="false" as off', async () => {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.file(
      'word/settings.xml',
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions w:val="false"/></w:settings>',
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    expect(document.model.trackRevisions).toBe(false)
  })

  it('removes the toggle when saving untracked', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    writeTrackRevisions(document, false)
    const xml = await zipText(
      await serialiseDocx(document),
      'word/settings.xml',
    )
    expect(xml).not.toContain('trackRevisions')
    const reparsed = await parseDocx(await serialiseDocx(document))
    expect(reparsed.model.trackRevisions).toBe(false)
  })

  it('inserts the toggle in schema order before later siblings', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    writeTrackRevisions(document, false)
    writeTrackRevisions(document, true)
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/settings.xml')
    expect(xml).toContain('<w:trackRevisions/>')
    const reparsed = await parseDocx(output)
    expect(reparsed.model.trackRevisions).toBe(true)
  })

  it('creates the part, relationship and content type when absent', async () => {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.remove('word/settings.xml')
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    expect(document.model.trackRevisions).toBe(false)
    writeTrackRevisions(document, true)
    const output = await serialiseDocx(document)
    const settings = await zipText(output, 'word/settings.xml')
    expect(settings).toContain('<w:trackRevisions/>')
    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    expect(rels).toContain('relationships/settings')
    const contentTypes = await zipText(output, '[Content_Types].xml')
    expect(contentTypes).toContain('wordprocessingml.settings+xml')
    const reparsed = await parseDocx(output)
    expect(reparsed.model.trackRevisions).toBe(true)
  })
})
