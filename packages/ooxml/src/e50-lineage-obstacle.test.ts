import { describe, expect, it } from 'bun:test'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { load, paragraphs } from './model-run-emphasis.test-support'

type Model = import('@obiter/contracts').DocumentModelWire

function shape(document: { model: Model }) {
  return paragraphs(document).map((p) => ({
    id: p.id,
    text: p.runs.map((r) => r.text).join(''),
    runs: p.runs.map((r) => ({ id: r.id, text: r.text })),
  }))
}

async function reload(document: Awaited<ReturnType<typeof parseDocx>>) {
  return parseDocx(await serialiseDocx(document))
}

describe('E50 lineage obstacles (real parser/serializer)', () => {
  it('formatting splits one run into several', async () => {
    const doc = await load(`<w:p><w:r><w:t>HelloWorld</w:t></w:r></w:p>`)
    const paragraph = paragraphs(doc)[0]
    if (!paragraph) throw new Error('paragraph')
    applyDocumentEdits(doc, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 5,
        bold: true,
      },
    ])
    const after = await reload(doc)
    console.log('SPLIT-BEFORE', JSON.stringify(shape(doc)))
    console.log('SPLIT-AFTER ', JSON.stringify(shape(after)))
    expect(shape(doc)[0]?.runs.length).toBeGreaterThan(1)
    expect(shape(after)[0]?.runs.length).toBeGreaterThan(1)
  })

  it('identical text exists in several runs and is indistinguishable by text', async () => {
    const doc = await load(
      `<w:p><w:r><w:t>Same</w:t></w:r><w:r><w:t>Same</w:t></w:r><w:r><w:t>Same</w:t></w:r></w:p>`,
    )
    const runs = paragraphs(doc)[0]?.runs ?? []
    console.log('IDENTICAL-RUNS', JSON.stringify(shape(doc)))
    expect(runs.length).toBe(3)
    expect(new Set(runs.map((r) => r.text)).size).toBe(1)
    expect(new Set(runs.map((r) => r.id)).size).toBe(3)
  })

  it('a cross-paragraph join moves runs between paragraphs', async () => {
    const doc = await load(
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>`,
    )
    const before = shape(doc)
    const first = before[0]
    const second = before[1]
    if (!first || !second) throw new Error('paragraphs')
    const headRun = first.runs[0]
    if (!headRun) throw new Error('head run')
    // A join concatenates the tail paragraph's text into the head run and
    // deletes the tail paragraph: two runs become one and a run crosses a
    // paragraph boundary.
    applyDocumentEdits(doc, [
      {
        type: 'replace_run_text',
        runId: headRun.id,
        text: 'AlphaBeta',
      },
      { type: 'delete_paragraph', paragraphId: second.id },
    ])
    const after = await reload(doc)
    console.log('JOIN-BEFORE', JSON.stringify(before))
    console.log('JOIN-AFTER ', JSON.stringify(shape(after)))
    expect(shape(after).map((p) => p.text)).toEqual(['AlphaBeta'])
    expect(shape(after)[0]?.runs.length).toBe(1)
  })

  it('tracked-change wrappers change the parsed run list', async () => {
    const doc = await load(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`)
    const run = paragraphs(doc)[0]?.runs[0]
    if (!run) throw new Error('run')
    applyDocumentEdits(
      doc,
      [{ type: 'replace_run_text', runId: run.id, text: 'Hello world' }],
      { author: 'Lex', date: '2026-09-27T12:00:00.000Z' },
    )
    const after = await reload(doc)
    console.log('TRACKED-AFTER', JSON.stringify(shape(after)))
    console.log(
      'TRACKED-CHANGES',
      JSON.stringify(
        after.model.changes.map((change) => ({
          kind: change.kind,
          paragraphId: change.paragraphId,
          runId: change.runId,
          text: change.text,
        })),
      ),
    )
    // Tracked runs are excluded from the paragraph model; the edit lives only
    // in `changes`, which carry no run id. This is the identity gap the
    // version lineage must bridge for tracked saves.
    expect(shape(after)[0]?.runs).toEqual([])
    expect(after.model.changes.length).toBeGreaterThan(0)
  })
})
