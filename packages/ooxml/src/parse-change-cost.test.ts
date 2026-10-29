import { describe, expect, it } from 'bun:test'

import { parseDocx } from './parse'
import { parseXmlElements } from './parts/overlay'
import { trackedChangeLookup } from './parts/tracked-change-nodes'
import { probePackage, W } from './share-safe-probe-kit'

const ins = (index: number) =>
  `<w:ins w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>text ${index}</w:t></w:r></w:ins>`

function changeDocument(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:r><w:t>before ${index} </w:t></w:r>${ins(index)}</w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

function moveDocument(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:moveFromRangeStart w:id="${index}" w:name="mv${index}"/>` +
      `<w:moveFrom w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>moved ${index}</w:t></w:r></w:moveFrom>` +
      `<w:moveFromRangeEnd w:id="${index}"/>` +
      `<w:moveToRangeStart w:id="${index}" w:name="mv${index}"/>` +
      `<w:moveTo w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>moved ${index}</w:t></w:r></w:moveTo>` +
      `<w:moveToRangeEnd w:id="${index}"/></w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

function rowInsertDocument(count: number) {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `<w:tr><w:trPr><w:ins w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:trPr><w:tc><w:p><w:r><w:t>cell ${index}</w:t></w:r></w:p></w:tc></w:tr>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>`
}

function replaceableFieldDocument(count: number) {
  const paragraphs = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF b${index} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>result ${index}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>tail ${index}</w:t></w:r></w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paragraphs}</w:body></w:document>`
}

function referenceDocument() {
  const paragraphs = 5091
  const body = Array.from({ length: paragraphs }, (_, index) => {
    const parts = [
      `<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:firstLine="720"/><w:jc w:val="both"/></w:pPr>`,
      `<w:r><w:t xml:space="preserve">Paragraph ${index} of a long styled document, with enough words to wrap several times in a page column. </w:t></w:r>`,
    ]
    if (index % 3 === 0) {
      parts.push(
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF b${index} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      )
    }
    if (index % 5 === 0) parts.push(ins(index))
    if (index % 7 === 0) {
      parts.push(
        `<w:moveFromRangeStart w:id="${index}" w:name="mv${index}"/><w:moveFrom w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>moved</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="${index}"/>`,
      )
    }
    return `<w:p>${parts.join('')}</w:p>`
  }).join('')
  const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:rPr><w:sz w:val="22"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:style></w:styles>`
  return {
    document: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    styles,
  }
}

async function timeParse(make: (count: number) => string, count: number) {
  const bytes = await probePackage({ document: make(count) })
  const started = Date.now()
  const document = await parseDocx(bytes)
  return { elapsed: Date.now() - started, document }
}

describe('change-heavy part cost', () => {
  it('parses 4000 tracked changes well inside a second', async () => {
    const { elapsed, document } = await timeParse(changeDocument, 4_000)
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(4_000)
    expect(document.model.changes.length).toBeGreaterThanOrEqual(4_000)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('reads tracked changes without growing with their square', async () => {
    const small = await timeParse(changeDocument, 500)
    const large = await timeParse(changeDocument, 4_000)
    expect(large.elapsed).toBeLessThan(Math.max(150, small.elapsed * 24))
  })

  it('parses 2000 moves well inside a second', async () => {
    const { elapsed, document } = await timeParse(moveDocument, 2_000)
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(2_000)
    expect(document.model.changes.length).toBeGreaterThanOrEqual(4_000)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('reads move ranges without growing with their square', async () => {
    const small = await timeParse(moveDocument, 250)
    const large = await timeParse(moveDocument, 2_000)
    expect(large.elapsed).toBeLessThan(Math.max(150, small.elapsed * 24))
  })
})

describe('row-level insert cost', () => {
  it('reads row-level inserts without walking every paragraph', async () => {
    const { elapsed, document } = await timeParse(rowInsertDocument, 32_000)
    expect(document.model.changes.length).toBeGreaterThanOrEqual(32_000)
    expect(elapsed).toBeLessThan(4_000)
  })

  it('keeps row-level inserts linear in the row count', async () => {
    const small = await timeParse(rowInsertDocument, 4_000)
    const large = await timeParse(rowInsertDocument, 32_000)
    expect(large.elapsed).toBeLessThan(Math.max(400, small.elapsed * 16))
  })
})

describe('paragraph lookup cost', () => {
  async function lookupOf(paragraphs: number) {
    const source = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${Array.from(
      { length: paragraphs },
      (_, index) => `<w:p><w:r><w:t>para ${index}</w:t></w:r></w:p>`,
    ).join('')}<w:sectPr/></w:body></w:document>`
    const document = await parseDocx(await probePackage({ document: source }))
    const anchors = [...document.paragraphAnchors.values()]
    expect(anchors).toHaveLength(paragraphs)
    const elements = parseXmlElements(source)
    const lookup = trackedChangeLookup(elements, anchors)
    return { ...lookup, elements }
  }

  it('answers a change no paragraph holds without walking every paragraph', async () => {
    const calls = 20_000
    const lookup = await lookupOf(16_000)
    const uncovered = [...lookup.elements]
      .reverse()
      .find((element) => lookup.paragraphAt(element) === undefined)
    if (uncovered === undefined)
      throw new Error('expected an uncovered element')
    expect(lookup.paragraphAt(uncovered)).toBeUndefined()
    const started = Date.now()
    for (let index = 0; index < calls; index += 1) lookup.paragraphAt(uncovered)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('field nesting through the parse', () => {
  it('asks the nesting question about range-replaceable fields, and asks it once', async () => {
    await timeParse(replaceableFieldDocument, 1_000)
    const small = await timeParse(replaceableFieldDocument, 2_000)
    const large = await timeParse(replaceableFieldDocument, 8_000)
    const fields = large.document.model.stories[0]?.fields
    expect(fields).toHaveLength(8_000)
    expect(fields?.every((field) => field.rangeReplaceable)).toBe(true)
    expect(large.elapsed).toBeLessThan(4_000)
    expect(large.elapsed).toBeLessThan(Math.max(400, small.elapsed * 12))
  })
})

describe('the deadline note fixture', () => {
  it('parses the fixture the model pool note is calibrated against', async () => {
    const bytes = await probePackage(referenceDocument())
    expect(bytes.byteLength).toBeLessThan(25 * 1024 * 1024)
    const started = Date.now()
    const document = await parseDocx(bytes)
    const elapsed = Date.now() - started
    const story = document.model.stories[0]
    expect(story?.paragraphs).toHaveLength(5_091)
    expect(story?.fields).toHaveLength(1_697)
    expect(document.model.changes.length).toBe(1_747)
    expect(
      document.model.changes.filter(
        (change) => change.elementName === 'moveFrom',
      ),
    ).toHaveLength(728)
    expect(elapsed).toBeLessThan(2_000)
  })
})
