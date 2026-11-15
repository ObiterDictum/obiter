import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  applyDocumentEdits,
  buildVersionLineage,
  createLineageRecorder,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  emptyDraftState,
  planDocumentSave,
  type DraftState,
} from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'
import {
  pendingCellIdMap,
  pendingCellInsert,
  pendingCellSlotIds,
  savedCellAnchor,
} from './document-pending-cell-map'
import { lineageCoversCoveredSlots } from './document-baseline-lineage'
import type { StructuralDraft } from './document-structural-drafts'
import { useWorkspaceDraftHistory } from './document-editor-history'

async function pendingTable() {
  const document = await parseDocx(await createSyntheticDocx(['Anchor']))
  const anchor = document.model.stories[0]?.paragraphs[0]?.id
  if (!anchor) throw new Error('Missing anchor')
  const state = emptyDraftState()
  state.structures = [
    { id: 'table', kind: 'table', paragraphId: anchor, rows: 1, columns: 2 },
  ]
  const painted = withStructuralDrafts(document.model, state.structures)
  const table = storyTables(painted.stories[0])[0]
  const cell = table?.rows[0]?.cells[1]?.paragraphIds[0]
  if (!cell) throw new Error('Missing cell')
  return { document, anchor, state, painted, cell }
}

function savedDocument(
  document: Awaited<ReturnType<typeof parseDocx>>,
  state: DraftState,
) {
  const plan = planDocumentSave(document.model, state)
  expect(plan.blocked).toEqual([])
  const before = structuredClone(document.model)
  const recorder = createLineageRecorder(document.model)
  applyDocumentEdits(document, plan.operations, undefined, recorder)
  const lineage = buildVersionLineage({
    recorder,
    model: document.model,
    canonicalParagraphIds: new Map(),
    baseVersionId: 'base',
    versionId: 'saved',
  })
  return { plan, before, lineage }
}

it('reports pending cell paragraphs and their runs as covered save slots', async () => {
  const { document, state, cell } = await pendingTable()
  state.extraRuns[cell] = [
    { id: 'cell-run', text: 'Cell', preservedXmlFragments: [] },
  ]
  state.format.emphasis = [
    { paragraphId: cell, runId: 'cell-run', from: 0, to: 4, bold: true },
  ]
  state.format.paragraphFormats[cell] = { alignment: 'center' }

  const slots = pendingCellSlotIds(document.model, state)
  expect(slots.paragraphIds.has(cell)).toBe(true)
  expect(slots.runIds.has('cell-run')).toBe(true)
})

it('keeps the save baseline resolved when pending cells carry text and formatting', async () => {
  const { document, state, cell } = await pendingTable()
  state.extraRuns[cell] = [
    { id: 'cell-run', text: 'Cell', preservedXmlFragments: [] },
  ]
  state.format.emphasis = [
    { paragraphId: cell, runId: 'cell-run', from: 0, to: 4, bold: true },
  ]
  state.format.paragraphFormats[cell] = { alignment: 'center' }

  const { plan, before, lineage } = savedDocument(document, state)
  expect(
    lineageCoversCoveredSlots(lineage, {
      covered: plan.covered,
      sent: state,
      fromModel: before,
    }),
  ).toBe(true)
})

it('maps pending cell paragraph ids onto the paragraphs the save created', async () => {
  const { document, state, cell } = await pendingTable()
  state.extraRuns[cell] = [
    { id: 'cell-run', text: 'Cell', preservedXmlFragments: [] },
  ]
  const { before } = savedDocument(document, state)
  const saved = await parseDocx(await serialiseDocx(document))

  const map = pendingCellIdMap(before, state, saved.model)
  const savedCell = map.get(cell)
  if (!savedCell) throw new Error('Pending cell id was not remapped')
  const paragraph = saved.model.stories
    .flatMap((story) => story.paragraphs)
    .find((item) => item.id === savedCell)
  expect(paragraph?.runs.map((run) => run.text).join('')).toContain('Cell')
})

it('resolves the saved cell anchor for an insert deferred until the table saves', async () => {
  const { document, anchor, state, painted, cell } = await pendingTable()
  const pending = pendingCellInsert(
    document.model,
    painted,
    state.structures,
    cell,
  )
  if (!pending) throw new Error('Missing pending insert')
  expect(pending).toMatchObject({
    anchorParagraphId: anchor,
    occurrence: 0,
    rowIndex: 0,
    columnIndex: 1,
  })
  if (savedCellAnchor(document.model, pending)) {
    throw new Error('Unsaved model should not resolve a cell anchor')
  }

  savedDocument(document, state)
  const saved = await parseDocx(await serialiseDocx(document))
  const resolved = savedCellAnchor(saved.model, pending)
  if (!resolved) throw new Error('Saved cell anchor was not found')
  const cellParagraph = saved.model.stories
    .flatMap((story) => story.paragraphs)
    .find((item) => item.id === resolved.paragraphId)
  expect(cellParagraph).toBeDefined()
})

it('carries a cross-reference and a page number inserted after the deferred save through to the reparsed cell', async () => {
  const { document, anchor, state, painted, cell } = await pendingTable()
  const pending = pendingCellInsert(
    document.model,
    painted,
    state.structures,
    cell,
  )
  if (!pending) throw new Error('Missing pending insert')
  savedDocument(document, state)
  const saved = await parseDocx(await serialiseDocx(document))
  const resolved = savedCellAnchor(saved.model, pending)
  if (!resolved) throw new Error('Saved cell anchor was not found')

  const after = emptyDraftState()
  after.structures = [
    {
      id: 'xref',
      kind: 'cross-reference',
      paragraphId: resolved.paragraphId,
      offset: 0,
      targetParagraphId: anchor,
    },
    {
      id: 'page',
      kind: 'page-number',
      paragraphId: resolved.paragraphId,
      offset: 0,
    },
    {
      id: 'image',
      kind: 'image',
      paragraphId: resolved.paragraphId,
      offset: 0,
      contentType: 'image/png',
      dataBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      widthPx: 10,
      heightPx: 10,
      name: 'Figure',
    },
  ]
  const plan = planDocumentSave(saved.model, after)
  expect(plan.blocked).toEqual([])
  expect(plan.operations.map((operation) => operation.type).sort()).toEqual([
    'insert_cross_reference',
    'insert_image',
    'insert_page_number',
  ])
  applyDocumentEdits(saved, plan.operations)
  const reparsed = await parseDocx(await serialiseDocx(saved))
  const xml = reparsed.model.stories
    .flatMap((story) => story.preservedXmlFragments)
    .join('')
  expect(xml).toContain('instrText')
  expect(xml).toContain('REF ')
  expect(xml).toContain('PAGE ')
  expect(xml).toContain('<w:drawing')
})

it('restores a deferred insert draft on undo and redo', () => {
  const hook = renderHook(() => useWorkspaceDraftHistory())
  const history = hook.result.current
  const draft: StructuralDraft = {
    id: 'xref',
    kind: 'cross-reference',
    paragraphId: 'saved-cell',
    offset: 0,
    targetParagraphId: 'anchor',
  }
  let state = emptyDraftState()
  state.structures = [draft]
  act(() => {
    history.record(state)
  })
  state = { ...state, structures: [] }
  let undone: DraftState | undefined
  act(() => {
    undone = history.stepBack(state) ?? undefined
  })
  expect(undone?.structures).toEqual([draft])
  let redone: DraftState | undefined
  act(() => {
    redone = history.stepForward(undone ?? state) ?? undefined
  })
  expect(redone?.structures).toEqual([])
})
