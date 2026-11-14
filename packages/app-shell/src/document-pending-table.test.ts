import { pendingTableChange } from './document-pending-table'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTable } from './components/document-workspace/page-table'
import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  createSyntheticDocx,
  parseDocx,
  applyDocumentEdits,
  serialiseDocx,
} from '@obiter/ooxml'
import { useInsertRibbon } from './components/document-workspace/use-insert-ribbon'
import { useWorkspaceDraftHistory } from './document-editor-history'
import {
  emptyDraftState,
  planDocumentSave,
  type DraftState,
} from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'

for (const edited of [false, true]) {
  for (const [type, rows, columns] of [
    ['insert_table_row', 3, 2],
    ['delete_table_row', 1, 2],
    ['insert_table_column', 2, 3],
    ['delete_table_column', 2, 1],
    ['delete_table', 0, 0],
  ] as const) {
    if (edited && type !== 'insert_table_row') continue
    it(
      edited
        ? 'text keeps its cell identity when a pending table gains a row'
        : `${type} updates a pending table, paints its shape, saves it and supports one-step undo and redo`,
      async () => {
        const { model } = await parseDocx(await createSyntheticDocx(['Anchor']))
        const anchor = model.stories[0]?.paragraphs[0]?.id
        if (!anchor) throw new Error('Missing anchor')
        let state: DraftState = emptyDraftState()
        const hook = renderHook(() => {
          const history = useWorkspaceDraftHistory()
          const painted = withStructuralDrafts(model, state.structures)
          const target =
            storyTables(painted.stories[0])[0]?.paragraphIds[0] ?? anchor
          const ribbon = useInsertRibbon(
            model,
            painted,
            { kind: 'caret', paragraphId: target, from: 0, to: 0 },
            0,
            false,
            { editingKind: 'document', onOpen: () => {}, onClose: () => {} },
            {
              ...state,
              deletedParagraphIds: new Set<string>(),
              setBreaks: () => {},
              setStructures: (update) => {
                history.record(state)
                state = { ...state, structures: update(state.structures) }
              },
            },
            {
              occurrences: [],
              entries: [],
              citingWires: [],
              fields: new Map(),
            },
            (message) => {
              throw new Error(message)
            },
          )
          return { history, ribbon, target }
        })
        act(() => {
          hook.result.current.ribbon.structure.onInsertTable(2, 2)
        })
        hook.rerender()
        if (edited) {
          state = {
            ...state,
            extraRuns: {
              [hook.result.current.target]: [
                { id: 'typed', text: 'Cell text', preservedXmlFragments: [] },
              ],
            },
          }
          hook.rerender()
        }
        const before = structuredClone(state)
        act(() => {
          const paragraphId = hook.result.current.target
          const operation =
            type === 'insert_table_row' || type === 'insert_table_column'
              ? { type, paragraphId, position: 'after' as const }
              : { type, paragraphId }
          hook.result.current.ribbon.structure.onTableStructure?.(operation)
        })
        hook.rerender()
        const after = structuredClone(state)
        const table = storyTables(
          withStructuralDrafts(model, state.structures).stories[0],
        )[0]
        expect(table?.rows.length ?? 0).toBe(rows)
        if (rows) expect(table?.rows[0]?.cells).toHaveLength(columns)
        if (table) {
          const html = renderToStaticMarkup(
            createElement(PageTable, {
              table,
              bordered: table.bordered,
              renderCell: () => '',
            }),
          )
          expect(html.match(/<tr\b/gu)).toHaveLength(rows)
          expect(html.match(/<td\b/gu)).toHaveLength(rows * columns)
        }
        const plan = planDocumentSave(model, state)
        expect(plan.blocked).toEqual([])
        if (edited) {
          expect(table?.paragraphIds[0]).toBe(hook.result.current.target)
          expect(plan.operations[0]).toMatchObject({
            cellEdits: [{ row: 0, column: 0, text: 'Cell text' }],
          })
        } else
          expect(plan.operations).toEqual(
            rows
              ? [{ type: 'insert_table', paragraphId: anchor, rows, columns }]
              : [],
          )
        act(() => {
          state = hook.result.current.history.stepBack(state) ?? state
        })
        expect(state).toEqual(before)
        act(() => {
          state = hook.result.current.history.stepForward(state) ?? state
        })
        expect(state).toEqual(after)
        hook.unmount()
      },
    )
  }
}

it('saving a newly inserted table preserves text in its cells', async () => {
  const document = await parseDocx(await createSyntheticDocx(['Anchor']))
  const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
  if (!paragraphId) throw new Error('Missing anchor')
  const state = emptyDraftState()
  state.structures = [
    { id: 'table', kind: 'table', paragraphId, rows: 2, columns: 2 },
  ]
  const cell = storyTables(
    withStructuralDrafts(document.model, state.structures).stories[0],
  )[0]?.paragraphIds[0]
  if (!cell) throw new Error('Missing cell')
  state.extraRuns[cell] = [
    { id: 'cell-run', text: 'Cell text <&>', preservedXmlFragments: [] },
  ]
  const plan = planDocumentSave(document.model, state)
  applyDocumentEdits(document, plan.operations)
  const saved = await parseDocx(await serialiseDocx(document))
  expect(
    saved.model.stories
      .flatMap((story) => story.paragraphs)
      .flatMap((p) => p.runs)
      .map((run) => run.text),
  ).toContain('Cell text <&>')
  expect(plan.operations).toEqual([
    {
      type: 'insert_table',
      paragraphId,
      rows: 2,
      columns: 2,
      cellEdits: [{ row: 0, column: 0, text: 'Cell text <&>' }],
    },
  ])
})

for (const cellEdits of [
  [{ row: 2, column: 0, text: 'Outside the table' }],
  [{ row: 0, column: 0, text: '\u0000' }],
]) {
  it(`table cell edits reject ${cellEdits[0]?.row === 2 ? 'coordinates beyond the inserted table' : 'invalid XML text'}`, async () => {
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
    if (!paragraphId) throw new Error('Missing anchor')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table', paragraphId, rows: 2, columns: 2, cellEdits },
      ]),
    ).toThrow()
  })
}

for (const type of ['insert_table_row', 'insert_table_column'] as const) {
  it(`${type} before typed cells preserves their identities and saved coordinates`, async () => {
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const anchor = document.model.stories[0]?.paragraphs[0]?.id
    if (!anchor) throw new Error('Missing anchor')
    const state = emptyDraftState()
    state.structures = [
      { id: 'table', kind: 'table', paragraphId: anchor, rows: 2, columns: 2 },
    ]
    const target = storyTables(
      withStructuralDrafts(document.model, state.structures).stories[0],
    )[0]?.paragraphIds[0]
    if (!target) throw new Error('Missing cell')
    state.extraRuns[target] = [
      { id: 'typed', text: 'Stay with cell', preservedXmlFragments: [] },
    ]
    const changed = pendingTableChange(document.model, state.structures, {
      type,
      paragraphId: target,
      position: 'before',
    })
    if (!changed) throw new Error('Missing changed table')
    state.structures = changed
    const table = storyTables(
      withStructuralDrafts(document.model, state.structures).stories[0],
    )[0]
    const row = type === 'insert_table_row' ? 1 : 0
    const column = type === 'insert_table_column' ? 1 : 0
    expect(table?.rows[row]?.cells[column]?.paragraphIds[0]).toBe(target)
    const plan = planDocumentSave(document.model, state)
    expect(plan.blocked).toEqual([])
    expect(plan.operations[0]).toMatchObject({
      cellEdits: [{ row, column, text: 'Stay with cell' }],
    })
    applyDocumentEdits(document, plan.operations)
    const saved = await parseDocx(await serialiseDocx(document))
    const savedTable = storyTables(saved.model.stories[0])[0]
    const savedId = savedTable?.rows[row]?.cells[column]?.paragraphIds[0]
    const paragraph = saved.model.stories[0]?.paragraphs.find(
      (item) => item.id === savedId,
    )
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'Stay with cell',
    )
  })
}
