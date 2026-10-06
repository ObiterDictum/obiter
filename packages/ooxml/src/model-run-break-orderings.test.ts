import { describe, expect, it } from 'bun:test'

import { OoxmlError, applyDocumentEdits } from './index'
import {
  documentXml,
  flag,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

const PAGE_BREAK = '<w:br w:type="page"/>'

async function loadRun(runXml: string) {
  const document = await load(`<w:p>${runXml}</w:p>`)
  const paragraph = paragraphs(document)[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Fixture is missing.')
  return { document, paragraph, run }
}

function invalidEditError(error: unknown) {
  return error instanceof OoxmlError && error.code === 'invalid-document-edit'
}

// Review round 4 finding 1: the operation list is a batch, not an ordered
// program, so a break may be listed before the run-keyed write it composes
// with. A page-break splice is paragraph-keyed, so the run-keyed writers must
// detect it themselves rather than rely only on the break seeing their keys.
describe('run-keyed writes listed after a page break splice', () => {
  it('refuses a run-keyed emphasis that cannot style the reopened tail', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'set_run_emphasis', runId: run.id, bold: true },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a run-keyed style listed after a page break splice', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a text replacement whose range contains the splice point', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    let thrown: unknown
    try {
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'replace_run_text', runId: run.id, text: 'Goodbye world' },
      ])
    } catch (error) {
      thrown = error
    }
    // A typed edit error, never the overlay serialiser's plain overlap Error
    // (which the API would turn into a 500).
    expect(invalidEditError(thrown)).toBe(true)
  })

  it('refuses a run-keyed write between two page break splices', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'set_run_emphasis', runId: run.id, bold: true },
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 7,
          kind: 'page',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('still composes the run-keyed write listed before the break', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 5,
        kind: 'page',
      },
    ])
    const xml = await documentXml(document)
    expect(xml.split(PAGE_BREAK).length - 1).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('Hello world')
    expect(runs.every((item) => flag(item, 'bold'))).toBe(true)
  })

  // Review round 5 finding 1: a break at a run's text-start boundary is placed
  // before the run tag and does not reopen the run, so it composes with a
  // run-keyed write. The narrowed detector must not treat that exact boundary
  // as inside, while every genuinely-inside splice (and the run-keyed whole-run
  // rebuild) still refuses.
  it('saves a run-keyed write after a break at the run start boundary', async () => {
    // Offset 5 is the second run's start. `locateOffset` returns the run's
    // opening offset without a split, so the standalone break run lands before
    // the tag and never reopens the run the write styles.
    const { document, paragraph } = await loadRun(
      '<w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r>',
    )
    const target = paragraph.runs[1]
    if (!target) throw new Error('Fixture is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 5,
        kind: 'page',
      },
      { type: 'set_run_emphasis', runId: target.id, bold: true },
    ])
    const xml = await documentXml(document)
    expect(xml.split(PAGE_BREAK).length - 1).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('Hello world')
    // The break run sits before the second run, so the styled run is found by
    // its text rather than by index.
    const bold = runs.filter((item) => flag(item, 'bold'))
    expect(bold.map((item) => item.text)).toEqual([' world'])
  })

  // Review round 6 finding 1: once the run-start boundary break composes with a
  // run-keyed write (round 5), a later break strictly inside the same run
  // materialises the run. The run-start splice is the preceding boundary and
  // must be left in place rather than trip the inside scan, so the batch
  // composes with both breaks retained instead of over-refusing.
  it('composes a run-start break, a run-keyed write and an inside break', async () => {
    const { document, paragraph } = await loadRun(
      '<w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r>',
    )
    const target = paragraph.runs[1]
    if (!target) throw new Error('Fixture is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 5,
        kind: 'page',
      },
      { type: 'set_run_emphasis', runId: target.id, bold: true },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 8,
        kind: 'page',
      },
    ])
    const xml = await documentXml(document)
    expect(xml.split(PAGE_BREAK).length - 1).toBe(2)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('Hello world')
    const bold = runs.filter((item) => flag(item, 'bold'))
    expect(bold.map((item) => item.text)).toEqual([' world'])
  })

  it('still refuses a run-keyed write after a break strictly inside the run', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'set_run_emphasis', runId: run.id, bold: true },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('still refuses a run-keyed write over a materialised whole-run break', async () => {
    // A run-keyed write before the break materialises the run as a
    // `...:page-break-run` whole-run replacement. It starts at the run's start
    // but is not zero-width, so the narrowed boundary must still refuse a later
    // run-keyed write rather than style a stale tail.
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>Hello world</w:t></w:r>',
    )
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'set_run_emphasis', runId: run.id, bold: true },
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
        { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })
})

// Review round 4 finding 2: materialising a run folds its preserved children
// and its text, but the child order must stay schema-valid. `w:rPr` is first
// in `CT_Run`, so a property write appended after a leading structural child
// must be emitted before it.
describe('materialised run child order', () => {
  it('emits the run properties before a preserved structural child', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:tab/><w:t>abc</w:t></w:r>',
    )
    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 1,
        kind: 'page',
      },
    ])
    const xml = await documentXml(document)
    // The property write appended `w:rPr` after the leading `w:tab`; the
    // rebuild must hoist it ahead of every structural child.
    expect(xml).toMatch(/<w:r><w:rPr>/u)
    expect(xml).not.toMatch(/<w:r><w:tab/u)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abc')
    expect(flag(runs[0] ?? { preservedXmlFragments: [] }, 'bold')).toBe(true)
  })
})
