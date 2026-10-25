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

import { buildRedactedDocx } from './redaction-docx-output'
import { acceptedDocxOccurrences } from './redaction-docx-occurrences'
import { assertNoSpanTextSurvives } from './redaction-docx-residual'
const decision = (decision: 'accept' | 'reject') => ({decision, decidedBy:'test', decidedAt:'2026-01-01T00:00:00Z'})
function span(text: string, start = 0, id = 'accepted') {
  return {id, text, start, end:start+text.length, category:'person_name' as const, source:'rampart_model' as const, confidence:'high' as const, suggestion:'redact' as const}
}
it('burns detector-missed body, header and comment occurrences while preserving an explicit rejection', async () => {
  const bytes = await fixture(p('Jane Doe Jane Doe Jane Doe'), {
    'word/header1.xml': `<w:hdr xmlns:w="${W}">${p('Jane Doe')}</w:hdr>`,
    'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0">${p('Jane Doe')}</w:comment></w:comments>`,
  })
  const {text} = await extractRedactionContent('docx', bytes)
  const accepted = span('Jane Doe', text.indexOf('Jane Doe', 9))
  const kept = span('Jane Doe', text.indexOf('Jane Doe', accepted.end), 'kept')
  const spans = [accepted, kept]
  const decisions = {accepted:decision('accept'), kept:decision('reject')}
  expect(acceptedDocxOccurrences(text, spans, decisions).additionalBurns).toBe(3)
  const output = await buildRedactedDocx({docxBytes:bytes,text,spans,decisions,outputMode:'pseudonymised',tokenMap:{PERSON_NAME_1:'Jane Doe'}})
  expect((await extractRedactionContent('docx', Buffer.from(output))).text).toBe('[PERSON_NAME_1]\n\n[PERSON_NAME_1] Jane Doe [PERSON_NAME_1]\n\n[Comment 0] [PERSON_NAME_1]')
  // The independent gate must reject mapped text without that exact exemption.
  await expect(assertNoSpanTextSurvives(output, [accepted])).rejects.toThrow('survives in mapped')
})
it.each(['Shruti', 'Georgia'])('preserves font definitions named %s while burning the person', async name => {
  const bytes = await fixture(p(name), {
    'word/theme/theme1.xml': `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${name}"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`,
    'word/fontTable.xml': `<w:fonts xmlns:w="${W}"><w:font w:name="${name}"/></w:fonts>`,
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  })
  const {text} = await extractRedactionContent('docx', bytes)
  const output = await buildRedactedDocx({docxBytes:bytes,text,spans:[span(name)],decisions:{accepted:decision('accept')},outputMode:'pseudonymised',tokenMap:{PERSON_NAME_1:name}})
  expect((await extractRedactionContent('docx', Buffer.from(output))).text).toBe('[PERSON_NAME_1]')
  const zip = await JSZip.loadAsync(output)
  expect(await zip.file('word/theme/theme1.xml')?.async('string')).toContain(`typeface="${name}"`)
  expect(await zip.file('word/fontTable.xml')?.async('string')).toContain(`w:name="${name}"`)
})
