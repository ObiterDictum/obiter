import JSZip from 'jszip'
import { expect, it } from 'bun:test'
import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

it('composes row insertion column insertion and row deletion in one save', async () => {
  let document = await parseDocx(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const anchor = document.model.stories[0]?.paragraphs[0]
  if (!anchor) throw new Error('Missing anchor')
  applyDocumentEdits(document, [
    { type: 'insert_table', paragraphId: anchor.id, rows: 2, columns: 2 },
  ])
  document = await parseDocx(await serialiseDocx(document))
  const cell = document.model.stories[0]?.paragraphs[1]
  if (!cell) throw new Error('Missing cell')
  applyDocumentEdits(document, [
    { type: 'insert_table_row', paragraphId: cell.id, position: 'after' },
    { type: 'insert_table_column', paragraphId: cell.id, position: 'after' },
    { type: 'delete_table_row', paragraphId: cell.id },
  ])
  const zip = await JSZip.loadAsync(await serialiseDocx(document))
  const xml = await zip.file('word/document.xml')?.async('string')
  const table = xml?.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/u)?.[0] ?? ''
  expect(table.match(/<w:gridCol\b/gu)).toHaveLength(3)
  const rows = table.match(/<w:tr\b[\s\S]*?<\/w:tr>/gu) ?? []
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(row.match(/<w:tc\b/gu)).toHaveLength(3)
  const ids = [...table.matchAll(/w14:paraId="([^"]+)"/gu)].map((m) => m[1])
  expect(ids).toHaveLength(6)
  expect(new Set(ids).size).toBe(ids.length)
})
