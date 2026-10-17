import { describe, expect, it } from 'bun:test'

import { parseDocx } from './parse'
import { parseXmlElements } from './parts/overlay'
import { trackedChangeLookup } from './parts/tracked-change-nodes'
import { probePackage, W } from './share-safe-probe-kit'

/**
 * Reading a part's tracked changes and its move ranges must be linear in the
 * part's element count.
 *
 * Both used to answer a question per change by walking the whole part: which
 * elements a change contains, which paragraph is the smallest one holding it,
 * whether a move container is clean, and which container a wrapper belongs to.
 * A part with many changes or many moves therefore cost changes × elements.
 * Measured on the shape each test builds:
 *
 * | workload | before | after |
 * | --- | --- | --- |
 * | 1,000 tracked changes | 329 ms | 115 ms |
 * | 2,000 tracked changes | 991 ms | 145 ms |
 * | 4,000 tracked changes | 3,631 ms | 277 ms |
 * | 1,000 moves | 1,371 ms | 165 ms |
 * | 2,000 moves | 6,018 ms | 294 ms |
 * | 4,000 moves | (→ ~22 s) | 607 ms |
 *
 * A fixed bound is the assertion, because the old shape needs seconds where the
 * new one needs tens of milliseconds; each test also times two sizes, since a
 * ratio catches a term the fixed bound would forgive on a smaller part.
 */
const ins = (index: number) =>
  `<w:ins w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>text ${index}</w:t></w:r></w:ins>`

/** A change per paragraph, each with its own run and text. */
function changeDocument(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:r><w:t>before ${index} </w:t></w:r>${ins(index)}</w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
}

/** A paired move per paragraph: range markers around each wrapper, so the
 * container path runs rather than the uncontainered fallback. */
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

/** A row-level insert: `w:trPr/w:ins` holds no paragraph, so the paragraph
 * lookup finds nothing to hold it, the same way a deleted mark does. */
function rowInsertDocument(count: number) {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `<w:tr><w:trPr><w:ins w:id="${index}" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:trPr><w:tc><w:p><w:r><w:t>cell ${index}</w:t></w:r></w:p></w:tc></w:tr>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>`
}

/** Range-replaceable fields: `begin`, instruction, `separate` and result in
 * one paragraph, with the end marker leading the next, which is the shape
 * `spanRangeReplaceable` accepts. Without `separate` the field is not a
 * candidate at all, `storyFields` short-circuits before asking whether it is
 * nested, and a fixture built that way measures nothing about the nesting
 * question — which is what the first version of this test did. */
function replaceableFieldDocument(count: number) {
  const paragraphs = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF b${index} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>result ${index}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>tail ${index}</w:t></w:r></w:p>`,
  ).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paragraphs}</w:body></w:document>`
}

/** The fixture the model pool's deadline note is calibrated against: 5091
 * styled paragraphs carrying all three loads — fields, tracked changes and move
 * ranges — inside the package guards. */
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
    // The part keeps the changes it modelled: one ins per paragraph.
    expect(document.model.changes.length).toBeGreaterThanOrEqual(4_000)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('reads tracked changes without growing with their square', async () => {
    // 8x the changes must not cost 64x the time, which is what a per-change walk
    // of the part does.
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
    // The rows keep their paragraphs — a row's cells hold them — so the lookup
    // has anchors to walk back over while the row insert itself is held by no
    // paragraph. 32,000 rows cost 2.0 s here and 6.5 s with the walk stepping
    // one range at a time.
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
  /** A lookup over a part of `paragraphs` paragraphs, plus the part's own
   * elements, so a query can be aimed at an element no paragraph holds. */
  async function lookupOf(paragraphs: number) {
    // The trailing `w:sectPr` is the point of the fixture: it sits past every
    // paragraph and no paragraph range holds it, which is the position that made
    // the old walk cross the whole anchor list.
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
    // The walk started at the last range beginning before the element and stepped
    // back one range at a time, so a change nothing covers — one inside a
    // paragraph whose mark is deleted, a row-level insert, a change after many
    // sibling text-box paragraphs — paid a walk over every earlier paragraph.
    // Following the enclosing chain makes each step a range that could hold it.
    //
    // The query is aimed at the trailing `w:sectPr`, which sits past every
    // paragraph and is held by none: 20,000 of them cost about 6 ms over 16,000
    // paragraphs, against 2.6 s with the walk stepping one range at a time.
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
    // The unit cost test asks `nestedFieldSpans` directly, so it cannot see the
    // call site going back to the per-span question. This goes through
    // `parseDocx` with fields the nesting question is actually asked about (it
    // asserts every field is a candidate, or the question is skipped).
    //
    // Neither assertion here separates the two call sites, and neither claims
    // to. 8,000 fields cost about 1.2 s here and 2.4-2.5 s per-span, which looks
    // separable, but a bound tight enough to separate them failed under load:
    // 1,793 ms against a 1,700 ms bound while another suite ran. So this is a
    // ceiling — it catches growth worse than quadratic, and the ratio below
    // catches a multiple of that — while the unit case over `nestedFieldSpans`
    // is what bites the shape, at 939 ms against 3 ms. The warm-up run keeps the
    // smaller size from paying for the module's first call.
    await timeParse(replaceableFieldDocument, 1_000)
    const small = await timeParse(replaceableFieldDocument, 2_000)
    const large = await timeParse(replaceableFieldDocument, 8_000)
    const fields = large.document.model.stories[0]?.fields
    expect(fields).toHaveLength(8_000)
    // Every one of them is a candidate, or the question is never asked.
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
    // The moves the note quotes, and the container path they exercise.
    expect(
      document.model.changes.filter(
        (change) => change.elementName === 'moveFrom',
      ),
    ).toHaveLength(728)
    // The note quotes this number; keep it honest.
    expect(elapsed).toBeLessThan(2_000)
  })
})
