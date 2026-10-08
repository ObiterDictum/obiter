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

    // Still exactly one TOA field: the update replaced the generated
    // range rather than splicing a second field next to it.
    expect(countOccurrences(xml, ' TOA \\h \\c "1" ')).toBe(1)
    // The new citation is marked once; the stored mark is not duplicated.
    expect(countOccurrences(xml, ' TA \\l "[2019] EWCA Civ 12"')).toBe(1)
    expect(countOccurrences(xml, ' TA \\l "[2020] UKSC 1"')).toBe(1)
    // The stored `_ToA` bookmark name is reused — not reallocated — and
    // the fresh citing paragraph takes the next free name.
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
    // The tail keeps the field's `end` and the anchor's remaining text.
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
    // The pre-split anchor still names itself — the field's `begin`
    // lives in the generated heading paragraph after it.
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
    // Strip the field's `end` character — the first one after the TOA
    // heading — so the update walk finds no tail to claim.
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
    // Deleting the tail removes the field's `end` — the refresh cannot
    // hold what it would need to preserve.
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

/**
 * The stored paragraph the field's `begin`, `TOA` instruction and
 * `separate` live in — the generated heading wire, which is the id an
 * `update_table_of_authorities` operation names.
 */
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
