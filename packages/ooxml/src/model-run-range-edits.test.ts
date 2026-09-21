import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

describe('set_run_emphasis paragraph range', () => {
  it('bolds two words inside a single run and leaves three runs', async () => {
    const { reparsed } = await applyRange([{ text: 'one two three' }], 4, 7)
    expect(reparsed.runs.map((run) => run.text)).toEqual([
      'one ',
      'two',
      ' three',
    ])
    expect(reparsed.runs.map(runBold)).toEqual([false, true, false])
  })

  it('bolds the covered part of each run when the selection spans two runs', async () => {
    const { reparsed } = await applyRange(
      [{ text: 'one two' }, { text: ' three four' }],
      4,
      13,
    )
    expect(reparsed.runs.map((run) => run.text)).toEqual([
      'one ',
      'two',
      ' three',
      ' four',
    ])
    expect(reparsed.runs.map(runBold)).toEqual([false, true, true, false])
  })

  it('does not split a run when the selection covers it whole', async () => {
    const { reparsed } = await applyRange(
      [{ text: 'aaa' }, { text: 'bbb' }],
      0,
      3,
    )
    expect(reparsed.runs.map((run) => run.text)).toEqual(['aaa', 'bbb'])
    expect(reparsed.runs.map(runBold)).toEqual([true, false])
  })

  it('keeps preservedXmlFragments on every part of a split run', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:r><w:t>Alice Example overview</w:t></w:r>',
          '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Alice Example overview</w:t></w:r>',
        ),
      ),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 6,
        to: 13,
        bold: true,
      },
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[0]
    expect(reparsed?.runs.length).toBeGreaterThan(1)
    for (const run of reparsed?.runs ?? []) {
      expect(run.preservedXmlFragments.join('')).toContain('vanish')
    }
  })

  it('still applies the whole-run form so persisted operations replay', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[1]?.runs[0]

    expect(reparsed?.id).toBe(run.id)
    expect(runBold(reparsed)).toBe(true)
  })

  it('round-trips a partial bold through apply, save, and reload', async () => {
    const { reparsed } = await applyRange([{ text: 'one two three' }], 4, 7)
    expect(reparsed.runs.map((run) => run.text)).toEqual([
      'one ',
      'two',
      ' three',
    ])
    expect(reparsed.runs.map(runBold)).toEqual([false, true, false])
  })

  it('keeps a tracked text replacement when a range emphasis cannot be recorded', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(
      document,
      [
        { type: 'replace_run_text', runId: run.id, text: 'Typed words here' },
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 6,
          to: 11,
          bold: true,
        },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('Typed words here')
    expect(xml).not.toContain('>words</w:t>')
  })

  it('still records whole-run emphasis under tracking', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(
      document,
      [{ type: 'set_run_emphasis', runId: run.id, bold: true }],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:rPrChange ')
    expect(xml).toContain('<w:b/>')
  })
})

describe('a cross-paragraph join persists its tail formatting', () => {
  it('keeps the appended tail italic through save and reload', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    const lastRun = paragraph?.runs[paragraph.runs.length - 1]
    if (!paragraph || !lastRun) throw new Error('Fixture run is missing.')
    const base = paragraph.runs.map((run) => run.text).join('').length
    const originalText = paragraph.runs.map((run) => run.text).join('')
    const appended = 'avo'
    // The shape a join emits: the tail text is folded onto the head
    // paragraph's last run, then its formatting is restated as a range
    // emphasis over the appended slice (server-side, after the text edit).
    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: lastRun.id,
        text: `${lastRun.text}${appended}`,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: base,
        to: base + appended.length,
        italic: true,
      },
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[0]
    expect(reparsed?.runs.map((run) => run.text).join('')).toBe(
      `${originalText}${appended}`,
    )
    // The appended characters are italic in the saved document, not just in
    // the editor's paint.
    const italicText = (reparsed?.runs ?? [])
      .filter((run) => runItalic(run))
      .map((run) => run.text)
      .join('')
    expect(italicText).toBe(appended)
  })

  it('serialises a text replacement and a partial bold as one string', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: first.id,
        runs: [{ text: 'Hello' }],
      },
    ])
    const reloaded = await parseDocx(await serialiseDocx(document))
    const inserted = mainParagraphs(reloaded)[1]
    const run = inserted?.runs[0]
    if (!inserted || !run) throw new Error('Inserted run is missing.')
    applyDocumentEdits(reloaded, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello!' },
      {
        type: 'set_run_emphasis',
        paragraphId: inserted.id,
        from: 0,
        to: 2,
        bold: true,
      },
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(reloaded)),
    )[1]
    const runs = reparsed?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('Hello!')
    expect(runs[0]?.text).toBe('He')
    expect(runBold(runs[0])).toBe(true)
    expect(
      runs
        .slice(1)
        .map((item) => item.text)
        .join(''),
    ).toBe('llo!')
    expect(runs.slice(1).some((item) => runBold(item))).toBe(false)
  })
})

async function applyRange(
  runs: Array<{ text: string; bold?: boolean }>,
  from: number,
  to: number,
) {
  const document = await parseDocx(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const first = mainParagraphs(document)[0]
  if (!first) throw new Error('Fixture paragraph is missing.')
  applyDocumentEdits(document, [
    {
      type: 'insert_paragraph_after',
      paragraphId: first.id,
      runs,
    },
  ])
  const reloaded = await parseDocx(await serialiseDocx(document))
  const inserted = mainParagraphs(reloaded)[1]
  if (!inserted) throw new Error('Inserted paragraph is missing.')
  applyDocumentEdits(reloaded, [
    {
      type: 'set_run_emphasis',
      paragraphId: inserted.id,
      from,
      to,
      bold: true,
    },
  ])
  const reparsed = mainParagraphs(
    await parseDocx(await serialiseDocx(reloaded)),
  )[1]
  if (!reparsed) throw new Error('Reloaded paragraph is missing.')
  return { inserted, reparsed }
}

function runBold(run: { preservedXmlFragments: string[] } | undefined) {
  return /<w:b\b(?![^>]*w:val="0")/i.test(
    run?.preservedXmlFragments.join('') ?? '',
  )
}

function runItalic(run: { preservedXmlFragments: string[] } | undefined) {
  return /<w:i\b(?![^>]*w:val="0")/i.test(
    run?.preservedXmlFragments.join('') ?? '',
  )
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(input: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(input)
  const part = zip.file(partName)
  if (!part) throw new Error(`${partName} is missing.`)
  return part.async('string')
}

async function withDocumentXml(input: Uint8Array, documentXml: string) {
  const zip = await JSZip.loadAsync(input)
  zip.file('word/document.xml', documentXml)
  return zip.generateAsync({ type: 'uint8array' })
}
