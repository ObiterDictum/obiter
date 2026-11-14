import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  applyDocumentEdits,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'

import { useWorkspaceDraftHistory } from './document-editor-history'
import { emptyDraftState, planDocumentSave } from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'

async function pendingTableCellIds(
  document: Awaited<ReturnType<typeof parseDocx>>,
  state: ReturnType<typeof emptyDraftState>,
) {
  const painted = withStructuralDrafts(document.model, state.structures)
  const table = storyTables(painted.stories[0])[0]
  if (!table) throw new Error('Missing pending table')
  return table.paragraphIds
}

it('persists run and paragraph formatting in new table cells through save and reparse', async () => {
  const document = await parseDocx(await createSyntheticDocx(['Anchor']))
  const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
  if (!paragraphId) throw new Error('Missing anchor')
  const state = emptyDraftState()
  state.structures = [
    { id: 'table', kind: 'table', paragraphId, rows: 1, columns: 1 },
  ]
  const [cell] = await pendingTableCellIds(document, state)
  if (!cell) throw new Error('Missing cell')

  state.extraRuns[cell] = [
    { id: 'run-1', text: 'Formatted', preservedXmlFragments: [] },
  ]
  state.format.emphasis = [
    { paragraphId: cell, runId: 'run-1', from: 0, to: 4, bold: true },
    { paragraphId: cell, runId: 'run-1', from: 4, to: 9, italic: true },
  ]
  state.format.paragraphFormats[cell] = {
    alignment: 'center',
    indentation: { firstLine: 720 },
    lineSpacing: { line: 360, lineRule: 'auto' },
  }

  const plan = planDocumentSave(document.model, state)
  expect(plan.blocked).toEqual([])
  const insert = plan.operations.find(
    (operation) => operation.type === 'insert_table',
  )
  if (insert?.type !== 'insert_table') throw new Error('Missing insert_table')
  const edit = insert.cellEdits?.find(
    (item) => item.row === 0 && item.column === 0,
  )
  expect(edit?.runs).toBeDefined()
  expect(edit?.paragraph).toMatchObject({
    alignment: 'center',
    indentation: { firstLine: 720 },
    lineSpacing: { line: 360, lineRule: 'auto' },
  })

  applyDocumentEdits(document, plan.operations)
  const saved = await parseDocx(await serialiseDocx(document))
  const savedCell = saved.model.stories
    .flatMap((story) => story.paragraphs)
    .find((paragraph) =>
      paragraph.runs
        .map((run) => run.text)
        .join('')
        .includes('Formatted'),
    )
  if (!savedCell) throw new Error('Saved cell paragraph is missing')
  const fragments = savedCell.preservedXmlFragments.join('')
  expect(fragments).toContain('<w:jc w:val="center"/>')
  expect(fragments).toContain('<w:ind ')
  expect(fragments).toContain('<w:spacing ')
  const runXml = savedCell.runs
    .map((run) => run.preservedXmlFragments.join(''))
    .join('')
  expect(runXml).toContain('<w:b/>')
  expect(runXml).toContain('<w:i/>')
})

it('carries numbering drafts for new table cells and inserted paragraphs into the save plan', async () => {
  const document = await parseDocx(await createSyntheticDocx(['Anchor']))
  const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
  if (!paragraphId) throw new Error('Missing anchor')
  const state = emptyDraftState()
  state.structures = [
    { id: 'table', kind: 'table', paragraphId, rows: 1, columns: 1 },
  ]
  const [cell] = await pendingTableCellIds(document, state)
  if (!cell) throw new Error('Missing cell')
  state.format.numbering[cell] = { numId: '7', ilvl: 0 }

  state.inserts = [
    { clientId: 'ins-1', afterParagraphId: paragraphId, text: 'Item' },
  ]
  state.format.numbering['ins-1'] = { numId: '3', ilvl: 1 }
  state.format.paragraphFormats['ins-1'] = { alignment: 'right' }

  const plan = planDocumentSave(document.model, state)
  expect(plan.blocked).toEqual([])

  const insert = plan.operations.find(
    (operation) => operation.type === 'insert_table',
  )
  if (insert?.type !== 'insert_table') throw new Error('Missing insert_table')
  expect(insert.cellEdits?.[0]?.paragraph?.numbering).toEqual({
    numId: '7',
    ilvl: 0,
  })

  const paragraphOp = plan.operations.find(
    (operation) => operation.type === 'insert_paragraph_after',
  )
  if (paragraphOp?.type !== 'insert_paragraph_after')
    throw new Error('Missing insert_paragraph_after')
  expect(paragraphOp.numbering).toEqual({ numId: '3', ilvl: 1 })
  expect(paragraphOp).toMatchObject({ alignment: 'right' })
})

it('restores pending-cell format drafts on undo and redo', async () => {
  const document = await parseDocx(await createSyntheticDocx(['Anchor']))
  const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
  if (!paragraphId) throw new Error('Missing anchor')
  const state = emptyDraftState()
  state.structures = [
    { id: 'table', kind: 'table', paragraphId, rows: 1, columns: 1 },
  ]
  const [cell] = await pendingTableCellIds(document, state)
  if (!cell) throw new Error('Missing cell')

  const hook = renderHook(() => useWorkspaceDraftHistory())
  const history = hook.result.current
  act(() => {
    history.record(state)
  })
  state.format.paragraphFormats[cell] = { alignment: 'center' }
  state.format.numbering[cell] = { numId: '4', ilvl: 0 }
  state.extraRuns[cell] = [
    { id: 'run-1', text: 'Cell', preservedXmlFragments: [] },
  ]
  state.format.emphasis = [
    { paragraphId: cell, runId: 'run-1', from: 0, to: 4, bold: true },
  ]
  const after = structuredClone(state)

  let undone: typeof state | undefined
  act(() => {
    undone = history.stepBack(state) ?? undefined
  })
  if (!undone) throw new Error('Undo did not restore a state')
  const plan = planDocumentSave(document.model, undone)
  const insert = plan.operations.find(
    (operation) => operation.type === 'insert_table',
  )
  if (insert?.type !== 'insert_table') throw new Error('Missing insert_table')
  expect(insert.cellEdits?.[0]?.paragraph).toBeUndefined()
  expect(insert.cellEdits?.[0]?.runs).toBeUndefined()

  let redone: typeof state | undefined
  act(() => {
    redone = history.stepForward(undone ?? state) ?? undefined
  })
  if (!redone) throw new Error('Redo did not restore a state')
  expect(redone).toEqual(after)
  const redonePlan = planDocumentSave(document.model, redone)
  const redoneInsert = redonePlan.operations.find(
    (operation) => operation.type === 'insert_table',
  )
  if (redoneInsert?.type !== 'insert_table')
    throw new Error('Missing insert_table')
  expect(redoneInsert.cellEdits?.[0]?.paragraph?.numbering).toEqual({
    numId: '4',
    ilvl: 0,
  })
  expect(redoneInsert.cellEdits?.[0]?.paragraph?.alignment).toBe('center')
})
