import { describe, expect, it } from 'bun:test'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { serialiseOverlay } from './parts/overlay'
import { load, paragraphs } from './model-run-emphasis.test-support'

type Model = import('@obiter/contracts').DocumentModelWire

function shape(document: { model: Model }) {
  return paragraphs(document).map((p) => ({
    id: p.id,
    runs: p.runs.map((r) => r.id),
    text: p.runs.map((r) => r.text).join(''),
  }))
}

async function reload(document: Awaited<ReturnType<typeof parseDocx>>) {
  try {
    return await parseDocx(await serialiseDocx(document))
  } catch (error) {
    for (const part of document.sourceParts.values()) {
      if (part.overlay) {
        try {
          serialiseOverlay(part.overlay)
        } catch (inner) {
          console.log('PART-FAIL', part.name, String(inner))
        }
      }
    }
    throw error
  }
}

const THREE = `\n<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>\n<w:p><w:r><w:t>Beta</w:t></w:r></w:p>\n<w:p><w:r><w:t>Gamma</w:t></w:r></w:p>\n`

function p(text: string) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
}

describe('E50 identity counterexamples (real parser)', () => {
  it('delete + insert can preserve the legacy id sequence while changing identity', async () => {
    const before = await load(THREE)
    const initial = shape(before)
    const beta = initial[1]?.id
    const alpha = initial[0]?.id
    if (!beta || !alpha) throw new Error('anchors')
    applyDocumentEdits(before, [
      { type: 'delete_paragraph', paragraphId: beta },
      { type: 'insert_paragraph_after', paragraphId: alpha, text: 'Delta' },
    ])
    const after = await reload(before)
    console.log('SEQ-BEFORE-IDS', JSON.stringify(initial.map((x) => x.id)))
    console.log('SEQ-AFTER-IDS ', JSON.stringify(shape(after).map((x) => x.id)))
    console.log(
      'SEQ-AFTER-TEXT',
      JSON.stringify(shape(after).map((x) => x.text)),
    )
    // The paragraph id sequence is identical to before, but para-000002 now
    // names Delta where it used to name Beta. Sequence comparison cannot see it.
    expect(shape(after).map((x) => x.id)).toEqual(initial.map((x) => x.id))
    expect(shape(after).map((x) => x.text)).toEqual(['Alpha', 'Delta', 'Gamma'])
  })

  it('duplicate paragraph text makes text matching ambiguous', async () => {
    const before = await load(p('Same') + p('Same') + p('Same'))
    const initial = shape(before)
    const middle = initial[1]?.id
    if (!middle) throw new Error('middle')
    applyDocumentEdits(before, [
      { type: 'delete_paragraph', paragraphId: middle },
    ])
    const after = await reload(before)
    console.log('DUP-BEFORE', JSON.stringify(initial))
    console.log('DUP-AFTER ', JSON.stringify(shape(after)))
    // Three identical texts collapse to two; no text/count heuristic can name
    // which one was removed.
    expect(shape(after).map((x) => x.text)).toEqual(['Same', 'Same'])
  })

  it('multi-run paragraphs get distinct run ids that shift on an insert', async () => {
    const two = `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>Bold</w:t></w:r><w:r><w:t>Italic</w:t></w:r></w:p>`
    const before = await load(two + p('Tail'))
    const initial = shape(before)
    const anchor = initial[0]?.id
    if (!anchor) throw new Error('anchor')
    expect(initial[0]?.runs.length).toBe(2)
    applyDocumentEdits(before, [
      { type: 'insert_paragraph_after', paragraphId: anchor, text: 'Mid' },
    ])
    const after = await reload(before)
    console.log('MULTI-BEFORE', JSON.stringify(initial))
    console.log('MULTI-AFTER ', JSON.stringify(shape(after)))
    expect(shape(after).map((x) => x.text)).toEqual([
      'BoldItalic',
      'Mid',
      'Tail',
    ])
  })
})
