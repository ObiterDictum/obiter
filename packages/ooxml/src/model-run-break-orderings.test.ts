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
