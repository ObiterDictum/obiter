import '@obiter/test-dom'
import JSZip from 'jszip'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTable } from './components/document-workspace/page-table'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  canonicaliseParagraphIdentities,
  applyDocumentEdits,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
  type TableStructureOperation,
} from '@obiter/ooxml'
import { useWorkspaceDraftHistory } from './document-editor-history'
import { emptyDraftState, type DraftState } from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'

async function fixture() {
  let doc = await parseDocx(await createSyntheticDocx(['Anchor', 'Second']))
  for (const paragraphId of doc.model.stories[0]?.paragraphs.map((p) => p.id) ??
    []) {
    applyDocumentEdits(doc, [
      { type: 'insert_table', paragraphId, rows: 2, columns: 2 },
    ])
  }
  const zip = await JSZip.loadAsync(await serialiseDocx(doc))
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('Missing XML')
  zip.file(
    'word/document.xml',
    xml
      .replaceAll('</w:tcPr>', '<w:shd w:fill="AABBCC"/></w:tcPr>')
      .replace(
        /<w:p\b([^>]*?)\/>/gu,
        '<w:p$1><w:r><w:t>Cell text</w:t></w:r></w:p>',
      )
      .replaceAll('</w:p>', '<w:r><w:t>Cell text</w:t></w:r></w:p>'),
  )
  doc = await parseDocx(await zip.generateAsync({ type: 'uint8array' }))
  return doc
}

function sequence(paragraphId: string): TableStructureOperation[] {
  return [
    { type: 'insert_table_row', paragraphId, position: 'after' },
    { type: 'insert_table_column', paragraphId, position: 'after' },
    { type: 'delete_table_row', paragraphId },
  ]
}

for (const twoTables of [false, true]) {
  it(`composes three pending operations on ${twoTables ? 'two different tables' : 'one table'} in the model page and saved document`, async () => {
    const doc = await fixture()
    const story = doc.model.stories[0]
    if (!story) throw new Error('Missing story')
    const originalCount = story.paragraphs.length
    const tables = storyTables(story)
    const anchors = tables
      .slice(0, twoTables ? 2 : 1)
      .map((t) => t.paragraphIds[0] ?? '')
    const operations = anchors.flatMap(sequence)
    const structures = operations.map((operation, i) => ({
      id: String(i),
      kind: 'table-structure' as const,
      paragraphId: operation.paragraphId,
      operation,
    }))
    const folded = withStructuralDrafts(doc.model, structures)
    applyDocumentEdits(doc, operations)
    const saved = await parseDocx(await serialiseDocx(doc))
    for (const model of [folded, saved.model]) {
      const current = model.stories[0]
      if (!current) throw new Error('Missing story')
      const painted = storyTables(current)
      expect(painted).toHaveLength(2)
      for (let i = 0; i < 2; i++) {
        const table = painted[i]
        expect(table?.rows).toHaveLength(2)
        if (!table) throw new Error('Missing table')
        const html = renderToStaticMarkup(
          createElement(PageTable, {
            table,
            renderCell: (cell) =>
              cell.paragraphIds
                .map((id) =>
                  current.paragraphs
                    .find((p) => p.id === id)
                    ?.runs.map((r) => r.text)
                    .join(''),
                )
                .join(''),
          }),
        )
        expect(html.match(/<tr\b/gu)).toHaveLength(2)
        expect(html.match(/<td\b/gu)).toHaveLength(i === 0 || twoTables ? 6 : 4)
        expect(html).toContain('Cell text')
        for (const row of table?.rows ?? [])
          expect(row.cells).toHaveLength(i === 0 || twoTables ? 3 : 2)
      }
      const ids = current.paragraphs.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(current.paragraphs).toHaveLength(
        originalCount + (twoTables ? 4 : 2),
      )
    }
  })
}

for (const type of [
  'insert_table_row',
  'insert_table_column',
  'delete_table_row',
  'delete_table_column',
  'delete_table',
  'sequence',
] as const) {
  it(`undo restores exact table identities text grid and properties and redo reapplies ${type}`, async () => {
    const doc = await fixture()
    const story = doc.model.stories[0]
    if (!story) throw new Error('Missing story')
    const paragraphId = storyTables(story)[0]?.paragraphIds[0] ?? ''
    const operations: TableStructureOperation[] =
      type === 'sequence'
        ? sequence(paragraphId)
        : type === 'insert_table_row' || type === 'insert_table_column'
          ? [{ type, paragraphId, position: 'after' }]
          : [{ type, paragraphId }]
    const { result, unmount } = renderHook(() => useWorkspaceDraftHistory())
    let state: DraftState = emptyDraftState()
    const snapshots = [withStructuralDrafts(doc.model, state.structures)]
    for (const [i, operation] of operations.entries()) {
      act(() => result.current.record(state))
      state = {
        ...state,
        structures: [
          ...state.structures,
          { id: String(i), kind: 'table-structure', paragraphId, operation },
        ],
      }
      snapshots.push(withStructuralDrafts(doc.model, state.structures))
    }
    for (let i = operations.length - 1; i >= 0; i--) {
      act(() => {
        state = result.current.stepBack(state) ?? state
      })
      expect(withStructuralDrafts(doc.model, state.structures)).toEqual(
        snapshots[i],
      )
    }
    expect(withStructuralDrafts(doc.model, state.structures)).toEqual(doc.model)
    for (let i = 1; i <= operations.length; i++) {
      act(() => {
        state = result.current.stepForward(state) ?? state
      })
      expect(withStructuralDrafts(doc.model, state.structures)).toEqual(
        snapshots[i],
      )
    }
    unmount()
  })
}
import { planDocumentSave } from './document-save-plan'

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Missing fixture value')
  return value
}

it('saves a composed row insertion column insertion and second table deletion through validation and apply', async () => {
  const doc = await fixture()
  const tables = storyTables(required(doc.model.stories[0]))
  const first = required(required(tables[0]).paragraphIds[0])
  const second = required(required(tables[1]).paragraphIds[0])
  const operations: TableStructureOperation[] = [
    { type: 'insert_table_row', paragraphId: first, position: 'after' },
    { type: 'insert_table_column', paragraphId: first, position: 'after' },
    { type: 'delete_table', paragraphId: second },
  ]
  const state = emptyDraftState()
  state.structures = operations.map((operation, i) => ({
    id: String(i),
    kind: 'table-structure',
    paragraphId: operation.paragraphId,
    operation,
  }))
  const plan = planDocumentSave(doc.model, state)
  expect(plan.blocked).toEqual([])
  expect(plan.operations).toHaveLength(3)
  applyDocumentEdits(doc, plan.operations)
  canonicaliseParagraphIdentities(doc)
  const saved = await parseDocx(await serialiseDocx(doc))
  expect(storyTables(required(saved.model.stories[0]))).toHaveLength(1)
  expect(
    required(storyTables(required(saved.model.stories[0]))[0]).rows,
  ).toHaveLength(3)
})

import { useInsertRibbon } from './components/document-workspace/use-insert-ribbon'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { TableStructureSurface } from './components/document-workspace/table-structure-surface'

it('deletes a pending row through the insert ribbon command', async () => {
  const doc = await fixture()
  const paragraphId = required(
    required(storyTables(required(doc.model.stories[0])).at(0)).paragraphIds[0],
  )
  let structures: DraftState['structures'] = [
    {
      id: 'insert',
      kind: 'table-structure',
      paragraphId,
      operation: { type: 'insert_table_row', paragraphId, position: 'after' },
    },
  ]
  const painted = withStructuralDrafts(doc.model, structures)
  const target = required(
    required(painted.stories[0]).paragraphs.find(
      (p) =>
        !required(doc.model.stories[0]).paragraphs.some(
          (old) => old.id === p.id,
        ),
    ),
  )
  const state = emptyDraftState()
  const { result, unmount } = renderHook(() =>
    useInsertRibbon(
      doc.model,
      painted,
      { kind: 'caret', paragraphId: target.id, from: 0, to: 0 },
      0,
      false,
      { editingKind: 'document', onOpen: () => {}, onClose: () => {} },
      {
        ...state,
        deletedParagraphIds: new Set<string>(),
        structures,
        setBreaks: () => {},
        setStructures: (update) => {
          structures = update(structures)
        },
      },
      { occurrences: [], entries: [], citingWires: [], fields: new Map() },
      (message) => {
        throw new Error(message)
      },
    ),
  )
  act(() =>
    result.current.structure.onTableStructure?.({
      type: 'delete_table_row',
      paragraphId: target.id,
    }),
  )
  expect(structures).toHaveLength(2)
  const plan = planDocumentSave(doc.model, { ...state, structures })
  expect(plan.blocked).toEqual([])
  applyDocumentEdits(doc, plan.operations)
  canonicaliseParagraphIdentities(doc)
  const saved = await parseDocx(await serialiseDocx(doc))
  expect(
    required(storyTables(required(saved.model.stories[0]))[0]).rows,
  ).toHaveLength(2)
  expect(
    required(
      storyTables(
        required(withStructuralDrafts(doc.model, structures).stories[0]),
      )[0],
    ).rows,
  ).toHaveLength(2)
  unmount()
})

it('Tab activates the first paragraph of the appended row', async () => {
  const view = render(
    createElement(TableStructureSurface, {
      onChange: () => {
        const row = document.createElement('tr')
        row.innerHTML =
          '<td><div data-paragraph-id="new" tabindex="0"></div></td>'
        row.querySelector('div')?.addEventListener('click', (event) => {
          ;(event.currentTarget as HTMLElement).focus()
        })
        view.container.querySelector('tbody')?.append(row)
      },
      children: createElement(
        'table',
        null,
        createElement(
          'tbody',
          null,
          createElement(
            'tr',
            null,
            createElement(
              'td',
              null,
              createElement('textarea', { 'data-paragraph-id': 'old' }),
            ),
          ),
        ),
      ),
    }),
  )
  const old = required(view.container.querySelector('textarea'))
  old.focus()
  fireEvent.keyDown(old, { key: 'Tab' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(document.activeElement?.getAttribute('data-paragraph-id')).toBe('new')
  cleanup()
})
it('saves text typed into the first cell of a pending appended row', async () => {
  const doc = await fixture()
  const table = required(storyTables(required(doc.model.stories[0]))[0])
  const paragraphId = required(table.rows.at(-1)?.cells.at(-1)?.paragraphIds[0])
  const state = emptyDraftState()
  state.structures = [
    {
      id: 'tab',
      kind: 'table-structure',
      paragraphId,
      operation: { type: 'insert_table_row', paragraphId, position: 'after' },
    },
  ]
  const painted = withStructuralDrafts(doc.model, state.structures)
  const id = required(
    storyTables(required(painted.stories[0]))[0]?.rows.at(-1)?.cells[0]
      ?.paragraphIds[0],
  )
  state.extraRuns[id] = [
    { id: 'typed', text: 'NEW', preservedXmlFragments: [] },
  ]
  const plan = planDocumentSave(doc.model, state)
  expect(plan.blocked).toEqual([])
  applyDocumentEdits(doc, plan.operations)
  canonicaliseParagraphIdentities(doc)
  const saved = await parseDocx(await serialiseDocx(doc))
  const lastId = required(
    storyTables(required(saved.model.stories[0]))[0]?.rows.at(-1)?.cells[0]
      ?.paragraphIds[0],
  )
  expect(
    saved.model.stories[0]?.paragraphs
      .find((p) => p.id === lastId)
      ?.runs.map((r) => r.text)
      .join(''),
  ).toBe('NEW')
})
