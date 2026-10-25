import { expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createSyntheticDocx } from '@obiter/ooxml'
import { extractRedactionContent } from './redaction-extraction'
import { findUncoveredDocxRegions } from './extraction-coverage'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const t = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`
const p = (value: string) => `<w:p>${t(value)}</w:p>`
async function fixture(body: string, extra: Record<string,string> = {}) {
  const zip = await JSZip.loadAsync(await createSyntheticDocx(['fixture']))
  zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`)
  for (const [name, text] of Object.entries(extra)) zip.file(name, text)
  return Buffer.from(await zip.generateAsync({type:'uint8array'}))
}
it.each([
  ['letterhead', 'word/header1.xml', `<w:hdr xmlns:w="${W}">${p('Ordinary Solicitors LLP')}${p('London office and correspondence address')}</w:hdr>`],
  ['header table', 'word/header1.xml', `<w:hdr xmlns:w="${W}"><w:tbl><w:tr><w:tc>${p('Ordinary Solicitors LLP')}</w:tc><w:tc>${p('London office and correspondence address')}</w:tc></w:tr></w:tbl></w:hdr>`],
  ['footnote', 'word/footnotes.xml', `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${p('Ordinary first paragraph of the note')}${p('Second paragraph of the note')}</w:footnote></w:footnotes>`],
])('covers reviewed multi-paragraph %s', async (_, name, xml) => {
  const bytes = await fixture(p('Public body'), {[name]: xml})
  const {text} = await extractRedactionContent('docx', bytes)
  expect(await findUncoveredDocxRegions(bytes, text)).toEqual([])
  expect((await findUncoveredDocxRegions(bytes, 'Public body')).length).toBeGreaterThan(0)
})
