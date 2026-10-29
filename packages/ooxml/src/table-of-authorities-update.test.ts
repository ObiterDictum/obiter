import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

const TRACKING = { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' }

describe('table-of-authorities update', () => {
  it('rebuilds the stored field in place and marks only the new citation', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const stored = await serialiseDocx(document)
    const first = countOccurrences(
      await zipText(stored, 'word/document.xml'),
      ' TA \\l "',
    )
    expect(first).toBe(1)

    const reparsed = await parseDocx(stored)
    const second = mainParagraphs(reparsed).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Alice Example overview',
    )
    if (!second) throw new Error('Fixture model is missing.')
    const head = toaFieldHead(reparsed)
    applyDocumentEdits(reparsed, [
      ...cite(reparsed, second.id, 'Noted [2019] EWCA Civ 12.'),
      { type: 'update_table_of_authorities', paragraphId: head.id },
    ])
    const output = await serialiseDocx(reparsed)
    const xml = await zipText(output, 'word/document.xml')

    expect(countOccurrences(xml, ' TOA \\h \\c "1" ')).toBe(1)
    expect(countOccurrences(xml, ' TA \\l "[2019] EWCA Civ 12"')).toBe(1)
    expect(countOccurrences(xml, ' TA \\l "[2020] UKSC 1"')).toBe(1)
    expect(xml).toContain('w:name="_ToA1"')
    expect(xml).toContain('PAGEREF _ToA1')
    expect(xml).toContain('w:name="_ToA2"')

    const reparsedTwice = await parseDocx(output)
    const entries = mainParagraphs(reparsedTwice).filter(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    expect(
      entries.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['[2019] EWCA Civ 12', '[2020] UKSC 1'])
    const tail = mainParagraphs(reparsedTwice).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Example referenceJane Example reference',
    )
    expect(
      tail?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="end"'),
        ),
      ),
    ).toBe(true)
  })

  it('leaves a refresh with no new citation marked exactly once', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const head = toaFieldHead(reparsed)
    applyDocumentEdits(reparsed, [
      { type: 'update_table_of_authorities', paragraphId: head.id },
    ])
    const xml = await zipText(
      await serialiseDocx(reparsed),
      'word/document.xml',
    )
    expect(countOccurrences(xml, ' TA \\l "[2020] UKSC 1"')).toBe(1)
    expect(countOccurrences(xml, ' TOA \\h \\c "1" ')).toBe(1)
    expect(countOccurrences(xml, 'w:name="_ToA')).toBe(1)
  })

  it('refuses a paragraph that is not the field head', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const anchorAgain = mainParagraphs(reparsed).find(
      (paragraph) => paragraph.id === anchor.id,
    )
    if (!anchorAgain) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        {
          type: 'update_table_of_authorities',
          paragraphId: anchorAgain.id,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a field whose end is missing', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const stored = await serialiseDocx(document)
    const xml = await zipText(stored, 'word/document.xml')
    const toaAt = xml.indexOf(' TOA ')
    const endAt = xml.indexOf('<w:fldChar w:fldCharType="end"/>', toaAt)
    expect(endAt).toBeGreaterThan(toaAt)
    const broken = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, endAt)}${xml.slice(endAt + '<w:fldChar w:fldCharType="end"/>'.length)}`,
    )
    const reparsed = await parseDocx(broken)
    const head = mainParagraphs(reparsed).find((paragraph) =>
      paragraph.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TOA '),
        ),
      ),
    )
    if (!head) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a field whose generated paragraphs a batch edit rewrites', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const head = toaFieldHead(reparsed)
    const entry = mainParagraphs(reparsed).find(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    const run = entry?.runs.find((item) => item.text.length > 0)
    if (!run) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'replace_run_text', runId: run.id, text: 'Rewritten' },
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('fails closed under tracked changes', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const head = toaFieldHead(reparsed)
    expect(() =>
      applyDocumentEdits(
        reparsed,
        [{ type: 'update_table_of_authorities', paragraphId: head.id }],
        TRACKING,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses a stored field a table interrupts', async () => {
    const stored = await storedToaDocument()
    const xml = await zipText(stored, 'word/document.xml')
    const toaEnd = fieldEndAfter(xml, xml.indexOf(' TOA '))
    const tailStart = paragraphStartBefore(xml, toaEnd)
    const foreign = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, tailStart)}<w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${xml.slice(tailStart)}`,
    )
    const reparsed = await parseDocx(foreign)
    const head = toaFieldHead(reparsed)
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a stored field whose end sits inside a content control', async () => {
    const stored = await storedToaDocument()
    const xml = await zipText(stored, 'word/document.xml')
    const toaEnd = fieldEndAfter(xml, xml.indexOf(' TOA '))
    const tailStart = paragraphStartBefore(xml, toaEnd)
    const tailEnd = xml.indexOf('</w:p>', toaEnd) + '</w:p>'.length
    const foreign = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, tailStart)}<w:sdt><w:sdtContent>${xml.slice(tailStart, tailEnd)}</w:sdtContent></w:sdt>${xml.slice(tailEnd)}`,
    )
    const reparsed = await parseDocx(foreign)
    const head = mainParagraphs(reparsed).find((paragraph) =>
      paragraph.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TOA '),
        ),
      ),
    )
    if (!head) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a stored field nested inside another field', async () => {
    const stored = await storedToaDocument()
    const xml = await zipText(stored, 'word/document.xml')
    const toaAt = xml.indexOf(' TOA ')
    const toaBegin = xml.lastIndexOf(
      '<w:fldChar w:fldCharType="begin"/>',
      toaAt,
    )
    const runStart = Math.max(
      xml.lastIndexOf('<w:r>', toaBegin),
      xml.lastIndexOf('<w:r ', toaBegin),
    )
    const foreign = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, runStart)}<w:r><w:fldChar w:fldCharType="begin"/></w:r>${xml.slice(runStart)}`,
    )
    const reparsed = await parseDocx(foreign)
    const head = toaFieldHead(reparsed)
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a deletion that drops only the field tail', async () => {
    const stored = await storedToaDocument()
    const reparsed = await parseDocx(stored)
    const tail = mainParagraphs(reparsed).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Example referenceJane Example reference',
    )
    if (!tail) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'delete_paragraph', paragraphId: tail.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('allows a deletion that removes the whole field range', async () => {
    const stored = await storedToaDocument()
    const reparsed = await parseDocx(stored)
    const head = toaFieldHead(reparsed)
    const paragraphs = mainParagraphs(reparsed)
    const headIndex = paragraphs.indexOf(head)
    const range = paragraphs.slice(headIndex, headIndex + 3)
    expect(
      range
        .at(-1)
        ?.runs.some((run) =>
          run.preservedXmlFragments.some((fragment) =>
            fragment.includes('fldCharType="end"'),
          ),
        ),
    ).toBe(true)
    applyDocumentEdits(
      reparsed,
      range.map((paragraph) => ({
        type: 'delete_paragraph' as const,
        paragraphId: paragraph.id,
      })),
    )
    const xml = await zipText(
      await serialiseDocx(reparsed),
      'word/document.xml',
    )
    expect(countOccurrences(xml, ' TOA ')).toBe(0)
    expect(countOccurrences(xml, 'fldCharType="begin"')).toBe(1)
    expect(countOccurrences(xml, 'fldCharType="end"')).toBe(1)
  })

  it('does not re-mark a citation whose stored mark splits across runs', async () => {
    const stored = await storedToaDocument()
    const xml = await zipText(stored, 'word/document.xml')
    const markAt = xml.indexOf(' TA \\l "[2020] UKSC 1"')
    expect(markAt).toBeGreaterThan(-1)
    const closeAt = xml.indexOf('</w:instrText>', markAt)
    const split = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, markAt)} TA \\l "[2020]</w:instrText></w:r><w:r><w:instrText xml:space="preserve"> UKSC 1" \\s "[2020] UKSC 1" \\c 1 ${xml.slice(closeAt)}`,
    )
    const reparsed = await parseDocx(split)
    const head = toaFieldHead(reparsed)
    applyDocumentEdits(reparsed, [
      { type: 'update_table_of_authorities', paragraphId: head.id },
    ])
    const output = await zipText(
      await serialiseDocx(reparsed),
      'word/document.xml',
    )
    expect(countOccurrences(output, ' TA \\l "[2020]')).toBe(1)
    expect(countOccurrences(output, ' UKSC 1" \\s ')).toBe(1)
    expect(countOccurrences(output, ' TOA \\h \\c "1" ')).toBe(1)
  })

  it('does not re-mark a citation whose stored mark is a fldSimple', async () => {
    const stored = await storedToaDocument()
    const xml = await zipText(stored, 'word/document.xml')
    const markBegin = xml.lastIndexOf(
      '<w:fldChar w:fldCharType="begin"/>',
      xml.indexOf(' TA \\l '),
    )
    const markBeginRun = Math.max(
      xml.lastIndexOf('<w:r>', markBegin),
      xml.lastIndexOf('<w:r ', markBegin),
    )
    const markEnd =
      xml.indexOf('<w:fldChar w:fldCharType="end"/>', xml.indexOf(' TA \\l ')) +
      '<w:fldChar w:fldCharType="end"/></w:r>'.length
    const simple = await rewritePart(
      stored,
      'word/document.xml',
      `${xml.slice(0, markBeginRun)}<w:fldSimple w:instr=" TA \\l &quot;[2020] UKSC 1&quot; \\s &quot;[2020] UKSC 1&quot; \\c 1 "/>${xml.slice(markEnd)}`,
    )
    const reparsed = await parseDocx(simple)
    const head = toaFieldHead(reparsed)
    applyDocumentEdits(reparsed, [
      { type: 'update_table_of_authorities', paragraphId: head.id },
    ])
    const output = await zipText(
      await serialiseDocx(reparsed),
      'word/document.xml',
    )
    expect(countOccurrences(output, ' TA \\l ')).toBe(1)
    expect(output).toContain('w:fldSimple')
    expect(countOccurrences(output, ' TOA \\h \\c "1" ')).toBe(1)
  })

  it('refuses when the batch deletes the field range', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const head = toaFieldHead(reparsed)
    const tail = mainParagraphs(reparsed).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Example referenceJane Example reference',
    )
    if (!tail) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(reparsed, [
        { type: 'delete_paragraph', paragraphId: tail.id },
        { type: 'update_table_of_authorities', paragraphId: head.id },
      ]),
    ).toThrowError()
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

async function storedToaDocument() {
  const document = await parseFixture()
  const { cited, anchor } = toaFixture(document)
  applyDocumentEdits(document, [
    ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
    {
      type: 'insert_table_of_authorities',
      paragraphId: anchor.id,
      offset: 5,
    },
  ])
  return serialiseDocx(document)
}

function fieldEndAfter(xml: string, from: number) {
  const first = xml.indexOf('<w:fldChar w:fldCharType="end"/>', from)
  expect(first).toBeGreaterThan(from)
  const second = xml.indexOf('<w:fldChar w:fldCharType="end"/>', first + 1)
  expect(second).toBeGreaterThan(first)
  return second
}

function paragraphStartBefore(xml: string, position: number) {
  const start = Math.max(
    xml.lastIndexOf('<w:p>', position),
    xml.lastIndexOf('<w:p ', position),
  )
  expect(start).toBeGreaterThan(-1)
  return start
}

function toaFixture(document: Awaited<ReturnType<typeof parseDocx>>) {
  const paragraphs = mainParagraphs(document)
  const byText = (text: string) =>
    paragraphs.find(
      (paragraph) => paragraph.runs.map((run) => run.text).join('') === text,
    )
  const cited = byText('Commented text')
  const second = byText('Alice Example overview')
  const anchor = byText('Jane Example referenceJane Example reference')
  if (!cited || !second || !anchor) {
    throw new Error('Fixture model is missing.')
  }
  return { cited, second, anchor }
}

function toaFieldHead(document: Awaited<ReturnType<typeof parseDocx>>) {
  const head = mainParagraphs(document).find(
    (paragraph) =>
      paragraph.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ) &&
      paragraph.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TOA '),
        ),
      ),
  )
  if (!head) throw new Error('Fixture model is missing.')
  return head
}

function cite(
  document: Awaited<ReturnType<typeof parseDocx>>,
  paragraphId: string,
  text: string,
) {
  const paragraph = mainParagraphs(document).find(
    (item) => item.id === paragraphId,
  )
  const run = paragraph?.runs.find((item) => item.text.length > 0)
  if (!run) throw new Error('Fixture run is missing.')
  return [{ type: 'replace_run_text' as const, runId: run.id, text }]
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

function countOccurrences(text: string, needle: string) {
  return text.split(needle).length - 1
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}

async function rewritePart(bytes: Uint8Array, name: string, value: string) {
  const zip = await JSZip.loadAsync(bytes)
  zip.file(name, value)
  return zip.generateAsync({ type: 'uint8array' })
}
