import JSZip from 'jszip'
import { expect, it } from 'bun:test'
import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  parseDocx,
  parseModelJson,
  serialiseDocx,
  serialiseModelJson,
} from './index'

const part = 'word/footnotes.xml'
const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const separators =
  '<w:footnote w:type="separator" w:id="-1"/><w:footnote w:type="continuationSeparator" w:id="0"/>'
const unsupported =
  '<w:footnote w:id="8"><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested content</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:footnote>'
const styled =
  '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t>Original note</w:t></w:r></w:p></w:footnote>'
const tracking = {
  author: 'Example reviewer',
  date: '2026-10-30T12:00:00.000Z',
}

async function fixture() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    part,
    `<w:footnotes xmlns:w="${namespace}">${separators}${unsupported}${styled}</w:footnotes>`,
  )
  const body = await zip.file('word/document.xml')?.async('string')
  if (!body) throw new Error('Fixture body is missing')
  zip.file(
    'word/document.xml',
    body
      .replace('<w:footnoteReference w:id="1"/>', '')
      .replace(
        '\n    <w:sectPr>',
        '<w:p><w:r><w:t>One</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t> Two</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr>',
      ),
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

function notes(model: Awaited<ReturnType<typeof parseDocx>>['model']) {
  const story = model.stories.find(({ kind }) => kind === 'footnotes')
  if (!story?.footnoteEntries) throw new Error('Missing footnote owners')
  return story
}

it('preserves ownership across empty separators, unknown blocks and tracked note text', async () => {
  const document = await fixture()
  const story = notes(document.model)
  const [nested, note] = story.paragraphs
  const run = note?.runs.find(({ text }) => text === 'Original note')
  if (!nested || !note || !run)
    throw new Error('Missing synthetic note content')
  expect(story.footnoteEntries).toEqual([
    { id: '8', paragraphIds: [nested.id], readOnly: true },
    { id: '1', paragraphIds: [note.id] },
  ])
  expect(
    notes(parseModelJson(serialiseModelJson(document))).footnoteEntries,
  ).toEqual(story.footnoteEntries)
  applyDocumentEdits(
    document,
    [{ type: 'replace_run_text', runId: run.id, text: 'Updated note' }],
    tracking,
  )
  const bytes = await serialiseDocx(document)
  const xml = await (await JSZip.loadAsync(bytes)).file(part)?.async('string')
  expect(xml).toContain(separators)
  expect(xml).toContain(unsupported)
  expect(xml).toContain('<w:pStyle w:val="FootnoteText"/>')
  expect(xml).toContain('<w:rStyle w:val="FootnoteReference"/>')
  const reloaded = await parseDocx(bytes)
  expect(
    notes(reloaded.model).footnoteEntries?.map(({ id, paragraphIds }) => [
      id,
      paragraphIds.length,
    ]),
  ).toEqual([
    ['8', 1],
    ['1', 1],
  ])
  expect(
    reloaded.model.changes.some(
      ({ kind, storyPartName }) => kind === 'insert' && storyPartName === part,
    ),
  ).toBe(true)
  expect(
    reloaded.model.changes.some(
      ({ kind, storyPartName }) => kind === 'delete' && storyPartName === part,
    ),
  ).toBe(true)
})

it('keeps a shared note until its final reference is deleted', async () => {
  let document = await fixture()
  const references = () =>
    document.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.flatMap(({ runs }) => runs)
      .filter(({ preservedXmlFragments }) =>
        preservedXmlFragments.includes('<w:footnoteReference w:id="1"/>'),
      ) ?? []
  expect(references()).toHaveLength(2)
  for (const expected of [true, false]) {
    const reference = references()[0]
    if (!reference) throw new Error('Missing reference')
    applyDocumentEdits(document, [
      { type: 'delete_footnote', runId: reference.id },
    ])
    expect(
      notes(document.model).footnoteEntries?.some(({ id }) => id === '1'),
    ).toBe(expected)
    const bytes = await serialiseDocx(document)
    const xml = await (await JSZip.loadAsync(bytes)).file(part)?.async('string')
    expect(xml).toContain(separators)
    expect(xml).toContain(unsupported)
    expect(xml?.includes(styled)).toBe(expected)
    document = await parseDocx(bytes)
  }
})
