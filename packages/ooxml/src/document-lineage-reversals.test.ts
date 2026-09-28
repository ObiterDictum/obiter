import { describe, expect, it } from 'bun:test'

import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  buildVersionLineage,
  canonicaliseParagraphIdentities,
  createLineageRecorder,
  parseDocx,
  serialiseDocx,
} from './index'
import {
  load,
  paragraphs,
  documentXml,
} from './model-run-emphasis.test-support'

type Doc = Awaited<ReturnType<typeof parseDocx>>

const TRACK = { author: 'Lex', date: '2026-09-27T12:00:00.000Z' }

function shape(document: Doc) {
  return paragraphs(document).map((paragraph) => ({
    id: paragraph.id,
    text: paragraph.runs.map((run) => run.text).join(''),
    runs: paragraph.runs.length,
  }))
}

async function reload(document: Doc) {
  return parseDocx(await serialiseDocx(document))
}

/** Applies tracked operations with a recorder and returns the built lineage. */
function applyTracked(
  document: Doc,
  operations: Parameters<typeof applyDocumentEdits>[1],
) {
  const recorder = createLineageRecorder(document.model)
  applyDocumentEdits(document, operations, TRACK, recorder)
  const canonical = canonicaliseParagraphIdentities(document)
  const lineage = buildVersionLineage({
    recorder,
    model: document.model,
    canonicalParagraphIds: canonical,
    baseVersionId: 'ver_1',
    versionId: 'ver_2',
    // The tracked writer's result runs are wrapped, so no run address is
    // trustworthy; the reversal group is the authoritative identity.
    runAddressesReliable: false,
  })
  return { recorder, lineage }
}

describe('tracked reversal lineage', () => {
  it('names a replacement by its persisted del and ins ids and rejects as a unit', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>`,
    )
    const run = paragraphs(document)[0]?.runs[0]
    if (!run) throw new Error('run')
    const { lineage } = applyTracked(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Jello' },
    ])
    expect(lineage.reversals).toEqual([
      {
        operation: 0,
        fromRunId: run.id,
        fromParagraphId: paragraphs(document)[0]?.id,
        rejectOoxmlIds: ['0', '1'],
      },
    ])
    const saved = await reload(document)
    expect(shape(saved)).toEqual([
      { id: expect.any(String), text: 'World', runs: 1 },
    ])
    applyTrackedChangeDecisions(
      saved,
      saved.model.changes.map((change) => change.id),
      'reject',
    )
    const reverted = await reload(saved)
    expect(shape(reverted).map((item) => item.text)).toEqual(['HelloWorld'])
    expect(reverted.model.changes).toHaveLength(0)
  })

  it('names a tracked emphasis run and rejecting removes the property change', async () => {
    const document = await load(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`)
    const run = paragraphs(document)[0]?.runs[0]
    if (!run) throw new Error('run')
    const { lineage } = applyTracked(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    expect(lineage.reversals?.[0]?.fromRunId).toBe(run.id)
    const saved = await reload(document)
    expect(saved.model.changes[0]?.elementName).toBe('rPrChange')
    // The run survives the reparse, but its `rPr` is wrapped by the change, so
    // the tracked formatting is visible in the serialized document.
    expect(await documentXml(saved)).toContain('<w:rPrChange')
    applyTrackedChangeDecisions(
      saved,
      saved.model.changes.map((change) => change.id),
      'reject',
    )
    const reverted = await reload(saved)
    expect(reverted.model.changes).toHaveLength(0)
    const xml = await documentXml(reverted)
    expect(xml).not.toContain('<w:rPrChange')
    expect(xml).not.toContain('<w:b/>')
  })

  it('names a tracked paragraph deletion and leaves the paragraph addressable', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>`,
    )
    const second = paragraphs(document)[1]
    if (!second) throw new Error('para')
    const { lineage } = applyTracked(document, [
      { type: 'delete_paragraph', paragraphId: second.id },
    ])
    expect(lineage.reversals?.[0]?.fromParagraphId).toBe(second.id)
    const saved = await reload(document)
    applyTrackedChangeDecisions(
      saved,
      saved.model.changes.map((change) => change.id),
      'reject',
    )
    const reverted = await reload(saved)
    expect(shape(reverted).map((item) => item.text)).toEqual(['Alpha', 'Beta'])
  })

  it('reverses a tracked paragraph insertion by rejecting its change and removing the shell', async () => {
    const document = await load(`<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>`)
    const first = paragraphs(document)[0]
    if (!first) throw new Error('para')
    const { lineage } = applyTracked(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: first.id,
        intentId: 'ins-1',
        text: 'Mid',
      },
    ])
    // The inserted paragraph's content is wrapped in `w:ins`, so its result
    // paragraph parses to no run. The reversal is carried on the paragraph
    // entry: reject the `ins` and remove that shell in one decision.
    expect(lineage.reversals).toBeUndefined()
    const entry = lineage.paragraphs.find(
      (paragraph) => paragraph.insertedByIntent === 'ins-1',
    )
    expect(entry?.trackedInsertChangeIds).toHaveLength(1)
    expect(entry?.toParagraphId).toMatch(/^para-w14-/u)
    expect(entry?.runs).toEqual([])

    const saved = await reload(document)
    expect(shape(saved).map((item) => item.text)).toEqual(['Alpha', ''])
    expect(saved.model.changes[0]?.elementName).toBe('ins')

    const insert = saved.model.changes.find(
      (change) => change.elementName === 'ins',
    )
    if (!insert || !entry?.toParagraphId) throw new Error('insert')
    applyTrackedChangeDecisions(saved, [insert.id], 'reject', [
      entry.toParagraphId,
    ])
    const reverted = await reload(saved)
    // One atomic decision restored the pre-insertion document exactly.
    expect(shape(reverted).map((item) => item.text)).toEqual(['Alpha'])
    expect(reverted.model.changes).toHaveLength(0)
  })

  it('refuses to remove a paragraph the rejected change does not live in', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>`,
    )
    const second = paragraphs(document)[1]
    if (!second) throw new Error('para')
    applyTracked(document, [
      {
        type: 'replace_run_text',
        runId: second.runs[0]?.id ?? '',
        text: 'BETA',
      },
    ])
    const saved = await reload(document)
    const change = saved.model.changes[0]
    const alpha = shape(saved)[0]?.id
    if (!change || !alpha) throw new Error('change')
    // The change is on Beta; removing Alpha's paragraph would delete untracked
    // content, so the removal is refused rather than obeyed.
    expect(() =>
      applyTrackedChangeDecisions(saved, [change.id], 'reject', [alpha]),
    ).toThrow()
  })

  it('refuses more than one hundred change ids', async () => {
    const document = await load(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`)
    const ids = Array.from({ length: 101 }, (_, index) => String(index))
    expect(() => applyTrackedChangeDecisions(document, ids, 'reject')).toThrow()
  })

  it('refuses more than one hundred shell removals', async () => {
    const document = await load(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`)
    const run = paragraphs(document)[0]?.runs[0]
    if (!run) throw new Error('run')
    applyTracked(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Jello' },
    ])
    const saved = await reload(document)
    const change = saved.model.changes[0]
    if (!change) throw new Error('change')
    const removals = Array.from(
      { length: 101 },
      (_, index) => `para-${String(index)}`,
    )
    expect(() =>
      applyTrackedChangeDecisions(saved, [change.id], 'reject', removals),
    ).toThrow()
  })

  it('reverses only the operation group the undo names', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t>World</w:t></w:r><w:r><w:t>Again</w:t></w:r></w:p>`,
    )
    const runs = paragraphs(document)[0]?.runs ?? []
    const [first, , third] = runs
    if (!first || !third) throw new Error('runs')
    const { lineage } = applyTracked(document, [
      { type: 'replace_run_text', runId: first.id, text: 'Jello' },
      { type: 'set_run_emphasis', runId: third.id, bold: true },
    ])
    // One rejection group per history step, so the emphasis survives the
    // replacement's reversal.
    expect(lineage.reversals).toHaveLength(2)
    const replaceGroup = lineage.reversals?.find(
      (reversal) => reversal.fromRunId === first.id,
    )
    expect(replaceGroup?.rejectOoxmlIds).toHaveLength(2)
    const saved = await reload(document)
    applyTrackedChangeDecisions(
      saved,
      saved.model.changes
        .filter((change) =>
          replaceGroup?.rejectOoxmlIds.includes(change.ooxmlId ?? ''),
        )
        .map((change) => change.id),
      'reject',
    )
    const reverted = await reload(saved)
    expect(shape(reverted).map((item) => item.text)).toEqual([
      'HelloWorldAgain',
    ])
    // The emphasis change is still recorded.
    expect(
      reverted.model.changes.some(
        (change) => change.elementName === 'rPrChange',
      ),
    ).toBe(true)
  })

  it('distinguishes duplicate run text by identity, not by text', async () => {
    const document = await load(
      `<w:p><w:r><w:t>Same</w:t></w:r><w:r><w:t>Same</w:t></w:r><w:r><w:t>Same</w:t></w:r></w:p>`,
    )
    const middle = paragraphs(document)[0]?.runs[1]
    if (!middle) throw new Error('run')
    const { lineage } = applyTracked(document, [
      { type: 'replace_run_text', runId: middle.id, text: 'Changed' },
    ])
    expect(lineage.reversals?.[0]?.fromRunId).toBe(middle.id)
    const saved = await reload(document)
    const del = saved.model.changes.find((change) => change.kind === 'delete')
    expect(del?.text).toBe('Same')
    // The address is the run object's identity, so a text match would be
    // ambiguous; the reversal names the exact run.
    expect(lineage.reversals?.[0]?.rejectOoxmlIds).toHaveLength(2)
  })

  it('cannot reverse a tracked change that was already accepted', async () => {
    const document = await load(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`)
    const run = paragraphs(document)[0]?.runs[0]
    if (!run) throw new Error('run')
    applyTracked(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Jello' },
    ])
    const saved = await reload(document)
    const ids = saved.model.changes.map((change) => change.id)
    applyTrackedChangeDecisions(saved, ids, 'accept')
    const accepted = await reload(saved)
    // The accepted change is gone; a rejection cannot name it. The lineage is
    // per-version, so the client re-resolves against the accepted model and
    // blocks rather than targeting an obsolete id.
    expect(accepted.model.changes).toHaveLength(0)
    expect(() => applyTrackedChangeDecisions(accepted, ids, 'reject')).toThrow()
  })

  it('records the change ids with their run in a mixed paragraph', async () => {
    const document = await load(
      `<w:p><w:r><w:t>One</w:t></w:r><w:r><w:t>Two</w:t></w:r></w:p>`,
    )
    const [first, second] = paragraphs(document)[0]?.runs ?? []
    if (!first || !second) throw new Error('runs')
    const { lineage } = applyTracked(document, [
      { type: 'replace_run_text', runId: first.id, text: 'Uno' },
      { type: 'replace_run_text', runId: second.id, text: 'Dos' },
    ])
    expect(lineage.reversals?.map((reversal) => reversal.fromRunId)).toEqual([
      first.id,
      second.id,
    ])
    expect(
      lineage.reversals?.every(
        (reversal) => reversal.fromParagraphId === paragraphs(document)[0]?.id,
      ),
    ).toBe(true)
  })
})
