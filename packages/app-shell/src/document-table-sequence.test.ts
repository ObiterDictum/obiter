import '@obiter/test-dom'
import JSZip from 'jszip'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTable } from './components/document-workspace/page-table'
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
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
