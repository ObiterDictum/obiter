import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTable } from './components/document-workspace/page-table'
import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
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
        ? 'text in new table cells must be saved before their structure changes'
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
          expect(
            hook.result.current.ribbon.structure.tableStructureUnavailable,
          ).toBe('Save text in new table cells before changing table structure')
          hook.unmount()
          return
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
