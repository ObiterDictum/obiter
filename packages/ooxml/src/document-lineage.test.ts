import { describe, expect, it } from 'bun:test'

import type { DocumentModelWire } from '@obiter/contracts'

import {
  applyDocumentEdits,
  canonicaliseParagraphIdentities,
  buildVersionLineage,
  createLineageRecorder,
  parseDocx,
  serialiseDocx,
} from './index'
import { load, paragraphs } from './model-run-emphasis.test-support'

function reload(document: Awaited<ReturnType<typeof parseDocx>>) {
  return serialiseDocx(document).then((bytes) => parseDocx(bytes))
}

function modelParagraphs(model: DocumentModelWire) {
  return (
    model.stories.find((story) => story.kind === 'document')?.paragraphs ?? []
  )
}

const THREE = `\n<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>\n<w:p><w:r><w:t>Beta</w:t></w:r></w:p>\n<w:p><w:r><w:t>Gamma</w:t></w:r></w:p>\n`

/**
 * Resolves a lineage run address against the actually reparsed model: the
 * paragraph id must exist and the run index must be in range. This proves the
 * lineage refers to the serialized result, not the mutate-in-memory model.
 */
function resolveRun(
  model: DocumentModelWire,
  paragraphId: string,
  runIndex: number,
) {
  // The lineage names paragraphs in every editable story — a canonicalised
  // header or footer paragraph is a legitimate `toParagraphId` — so
  // resolution searches all of them, not just the body.
  const paragraph = model.stories
    .flatMap((story) => story.paragraphs)
    .find((item) => item.id === paragraphId)
  expect(paragraph).toBeDefined()
  return paragraph?.runs[runIndex]
}

describe('version lineage resolves against the reparsed DOCX', () => {
  it('records a mid-document insert as inserted and resolvable', async () => {
    const document = await load(THREE)
    const recorder = createLineageRecorder(document.model)
    const anchor = paragraphs(document)[0]?.id
    if (!anchor) throw new Error('anchor')
    applyDocumentEdits(
      document,
      [
        {
          type: 'insert_paragraph_after',
          paragraphId: anchor,
          text: 'Inserted',
        },
      ],
      undefined,
      recorder,
    )
    const canonical = canonicaliseParagraphIdentities(document)
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
    })
    const after = await reload(document)

    const inserted = lineage.paragraphs.find(
      (item) => item.fromParagraphId === null,
    )
    expect(inserted?.insertedByOperation).toBe(0)
    expect(inserted?.toParagraphId).toBeDefined()
    for (const paragraph of lineage.paragraphs) {
      if (paragraph.toParagraphId === null) continue
      for (const run of paragraph.runs) {
        expect(
          resolveRun(after.model, paragraph.toParagraphId, run.runIndex),
        ).toBeDefined()
      }
    }
  })

  it('expresses a formatting split as one base run becoming several result runs', async () => {
    const document = await load(`<w:p><w:r><w:t>HelloWorld</w:t></w:r></w:p>`)
    const recorder = createLineageRecorder(document.model)
    const paragraph = paragraphs(document)[0]
    const baseRun = paragraph?.runs[0]
    if (!paragraph || !baseRun) throw new Error('paragraph')
    applyDocumentEdits(
      document,
      [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 5,
          to: 10,
          bold: true,
        },
      ],
      undefined,
      recorder,
    )
    const canonical = canonicaliseParagraphIdentities(document)
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
    })
    const after = await reload(document)

    const entry = lineage.paragraphs[0]
    expect(entry?.runs.length).toBe(2)
    const segments = (entry?.runs ?? []).flatMap((run) => run.segments)
    const fromBase = segments.filter(
      (segment) => segment.fromRunId === baseRun.id,
    )
    expect(
      fromBase.map((segment) => [segment.fromOffset, segment.toOffset]),
    ).toEqual([
      [0, 5],
      [5, 10],
    ])
    for (const run of entry?.runs ?? []) {
      expect(
        resolveRun(after.model, entry?.toParagraphId ?? '', run.runIndex),
      ).toBeDefined()
    }
  })

  it('keeps duplicate run text distinguishable by lineage', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Same</w:t></w:r><w:r><w:t>Same</w:t></w:r></w:p>`,
    )
    const recorder = createLineageRecorder(document.model)
    const paragraph = paragraphs(document)[0]
    const second = paragraph?.runs[1]
    if (!paragraph || !second) throw new Error('paragraph')
    applyDocumentEdits(
      document,
      [{ type: 'replace_run_text', runId: second.id, text: 'Changed' }],
      undefined,
      recorder,
    )
    canonicaliseParagraphIdentities(document)
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: new Map(),
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
    })
    const entry = lineage.paragraphs[0]
    const origins = (entry?.runs ?? []).map((run) =>
      run.segments.map((segment) => segment.fromRunId),
    )
    expect(origins).toEqual([[paragraph.runs[0]?.id], [second.id]])
  })

  it('serialises a delete and an insert at the same XML boundary', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>`,
    )
    const recorder = createLineageRecorder(document.model)
    const [first, second] = paragraphs(document)
    if (!first || !second) throw new Error('paragraphs')
    applyDocumentEdits(
      document,
      [
        { type: 'insert_paragraph_after', paragraphId: first.id, text: 'Mid' },
        { type: 'delete_paragraph', paragraphId: second.id },
      ],
      undefined,
      recorder,
    )
    const canonical = canonicaliseParagraphIdentities(document)
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
    })
    const after = await reload(document)
    expect(modelParagraphs(after.model).map((p) => p.runs[0]?.text)).toEqual([
      'Alpha',
      'Mid',
    ])
    for (const paragraph of lineage.paragraphs) {
      if (paragraph.toParagraphId === null) continue
      for (const run of paragraph.runs) {
        expect(
          resolveRun(after.model, paragraph.toParagraphId, run.runIndex),
        ).toBeDefined()
      }
    }
  })
})
