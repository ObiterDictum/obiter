import { runDisplayText } from './document-page-media'
import { paragraphNeighborResolver } from './components/document-workspace/paragraph-arrow'
import { expect, it } from 'bun:test'
import {
  createBlankDocx,
  applyDocumentEdits,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { emptyDraftState, planDocumentSave } from './document-save-plan'
import { effectiveParagraph } from './document-model-text'
import { inlineChanges, inlineSlice } from './document-inline-changes'
import {
  buildPendingRedlines,
  pendingParagraphChanges,
} from './document-pending-redlines'

it('keeps covered draft redlines, editable mappings and saved revisions equal for whole runs and joins', async () => {
  for (const item of [
    {
      xml: '<w:t>Order 60,000 units</w:t>',
      next: 'Order 45,000 units',
      removed: '60,000',
      inserted: '45,000',
    },
    {
      xml: '<w:t>old</w:t><w:tab/>',
      next: 'new',
      removed: 'old\t',
      inserted: 'new\t',
    },
    {
      xml: '<w:t>old</w:t><w:br/><w:t>line</w:t>',
      next: 'new\nline',
      removed: 'old\nline',
      inserted: 'new\nline',
    },
    {
      xml: '<w:t>head</w:t>',
      next: 'head tail',
      removed: '',
      inserted: ' tail',
      join: true,
    },
    { xml: '', next: 'typed', removed: '', inserted: 'typed', runless: true },
    {
      xml: '<w:t>anchor</w:t>',
      next: 'new paragraph',
      removed: '',
      inserted: 'new paragraph',
      insert: true,
    },
    {
      xml: '<w:t>anchor</w:t>',
      next: 'new paragraph',
      removed: '',
      inserted: 'new paragraph',
      insert: true,
      deleteAnchor: true,
    },
  ]) {
    const fixture = await parseDocx(await createBlankDocx())
    const part = fixture.sourceParts.get('word/document.xml')
    if (!part) throw new Error('Missing fixture document part')
    part.originalPayload = new TextEncoder().encode(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${item.runless ? '' : `<w:r>${item.xml}</w:r>`}</w:p><w:p><w:r><w:t> tail</w:t></w:r></w:p></w:body></w:document>`,
    )
    const document = await parseDocx(await serialiseDocx(fixture))
    const paragraph = document.model.stories[0]?.paragraphs[0]
    const tail = document.model.stories[0]?.paragraphs[1]
    const run = paragraph?.runs[0]
    if (!paragraph || !tail || (!run && !item.runless))
      throw new Error('Missing fixture paragraph')
    const state = emptyDraftState()
    if (item.insert)
      state.inserts.push({
        clientId: 'pending-paragraph',
        afterParagraphId: paragraph.id,
        text: item.next,
      })
    else if (item.runless)
      state.extraRuns[paragraph.id] = [
        { id: 'pending-run', text: item.next, preservedXmlFragments: [] },
      ]
    else if (item.join) {
      state.extraRuns[paragraph.id] = tail.runs
      state.deletedParagraphIds = [tail.id]
    } else if (run) state.drafts[run.id] = item.next
    if (item.deleteAnchor) state.deletedParagraphIds = [paragraph.id]
    const painted = buildPendingRedlines(document.model, state)
    expect(document.model.changes).toEqual([])
    if (item.runless) {
      const neighbors = paragraphNeighborResolver({
        model: document.model,
        paragraphs: document.model.stories[0]?.paragraphs ?? [],
        drafts: state.drafts,
        extraRuns: state.extraRuns,
        inserts: [],
        deletedParagraphIds: [],
      })
      expect(neighbors(tail.id).previous?.id).toBe(paragraph.id)
      expect(neighbors(paragraph.id).next?.id).toBe(tail.id)
    }
    const effective = effectiveParagraph(
      item.insert
        ? {
            id: 'pending-paragraph',
            runs: [
              { id: 'pending-run', text: item.next, preservedXmlFragments: [] },
            ],
            preservedXmlFragments: [],
          }
        : paragraph,
      state.drafts,
      state.extraRuns[paragraph.id],
    )
    const projection = inlineChanges(
      effective,
      document.model.changes,
      undefined,
      pendingParagraphChanges(painted, effective.id),
    )
    const removed = projection.spans
      .filter((span) => span.deleted)
      .map((span) => projection.text.slice(span.from, span.to))
      .join('')
    const inserted = projection.spans
      .filter((span) => !span.deleted)
      .map((span) => projection.text.slice(span.from, span.to))
      .join('')
    expect([removed, inserted]).toEqual([item.removed, item.inserted])
    expect(projection.editableText).toBe(item.next)
    for (let at = 0; at <= item.next.length; at++)
      expect(projection.toEditable(projection.toDisplay(at))).toBe(at)
    const insertion = projection.spans.find((span) => span.editable)
    if (!insertion) throw new Error('Missing pending insertion')
    const slice = inlineSlice(projection, insertion.from, insertion.to)
    expect(slice.edit(slice.text + '!')).toBe(slice.editableText + '!')
    applyDocumentEdits(
      document,
      planDocumentSave(document.model, state).operations,
      { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
    )
    const saved = await parseDocx(await serialiseDocx(document))
    if (item.deleteAnchor)
      expect(
        saved.model.changes.some(
          (change) => change.kind === 'delete' && change.text === 'anchor',
        ),
      ).toBe(true)
    expect(
      saved.model.changes
        .filter(
          (change) =>
            change.text &&
            !(
              item.deleteAnchor &&
              change.kind === 'delete' &&
              change.text === 'anchor'
            ),
        )
        .filter(
          (change) =>
            !item.join || change.text !== ' tail' || change.kind === 'insert',
        )
        .map((change) => [change.kind, change.text]),
    ).toEqual([
      ...(item.removed ? [['delete', item.removed]] : []),
      ['insert', item.inserted],
    ])
    if (item.join) {
      const deleted = inlineChanges(
        tail,
        document.model.changes,
        undefined,
        pendingParagraphChanges(painted, tail.id),
      )
      expect(deleted.editableText).toBe('')
      expect(
        deleted.spans.map((span) => [span.deleted, span.change.text]),
      ).toEqual([[true, ' tail']])
    }
  }
})

it('marks a covered empty paragraph insertion before it has editable text', async () => {
  const document = await parseDocx(await createBlankDocx())
  const anchor = document.model.stories[0]?.paragraphs[0]
  if (!anchor) throw new Error('Missing fixture paragraph')
  const state = emptyDraftState()
  state.inserts.push({
    clientId: 'new-empty',
    afterParagraphId: anchor.id,
    text: '',
  })
  const painted = buildPendingRedlines(document.model, state)
  expect(pendingParagraphChanges(painted, 'new-empty')).toMatchObject([
    {
      kind: 'insert',
      text: '¶',
      pending: { from: 0, to: 0, displayOnly: true },
    },
  ])
  applyDocumentEdits(
    document,
    planDocumentSave(document.model, state).operations,
    { author: 'Synthetic Reviewer', date: '2026-10-24T12:00:00.000Z' },
  )
  const saved = await parseDocx(await serialiseDocx(document))
  expect(saved.model.changes.some((change) => change.kind === 'insert')).toBe(
    true,
  )
})

it('reuses the unchanged paragraph projection with tracking off', async () => {
  const { model } = await parseDocx(await createBlankDocx())
  const paragraph = model.stories[0]?.paragraphs[0]
  if (!paragraph) throw new Error('Missing paragraph')
  const project = () =>
    inlineChanges(
      paragraph,
      model.changes,
      'word/document.xml',
      pendingParagraphChanges(undefined, paragraph.id, 'word/document.xml'),
    )
  expect(project()).toBe(project())
})

it('paints pending deleted text with its source run instead of a preceding PAGE field', async () => {
  const { model } = await parseDocx(await createBlankDocx())
  const paragraph = model.stories[0]?.paragraphs[0]
  if (!paragraph) throw new Error('Missing paragraph')
  paragraph.runs = [
    {
      id: 'field',
      text: '',
      preservedXmlFragments: ['<w:instrText> PAGE </w:instrText>'],
    },
    { id: 'text', text: 'new', preservedXmlFragments: [] },
  ]
  const projection = inlineChanges(paragraph, [], 'word/document.xml', [
    {
      id: 'pending',
      kind: 'delete',
      elementName: 'del',
      text: 'old',
      runId: 'text',
      paragraphId: paragraph.id,
      storyPartName: 'word/document.xml',
      inlinePosition: { beforeRunId: null },
      pending: { from: 0, to: 0 },
    },
  ])
  const deleted = projection.paragraph.runs.find(
    (run) => run.id === 'pending:inline',
  )
  if (!deleted) throw new Error('Missing deletion')
  expect(runDisplayText(deleted, 5)).toBe('old')
})
