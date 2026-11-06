import JSZip from 'jszip'
import { expect, it } from 'bun:test'
import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

for (const [type, rows, columns] of [
  ['insert_table_row', 3, 2],
  ['insert_table_column', 2, 3],
  ['delete_table_row', 1, 2],
  ['delete_table_column', 2, 1],
  ['delete_table', 0, 0],
] as const) {
  it(`${type} updates the table and grid without duplicating paragraph ids`, async () => {
    let document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const anchor = document.model.stories.find((s) => s.kind === 'document')
      ?.paragraphs[0]
    if (!anchor) throw new Error('Missing anchor')
    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 2, columns: 2 },
    ])
    document = await parseDocx(await serialiseDocx(document))
    const cell = document.model.stories.find((s) => s.kind === 'document')
      ?.paragraphs[1]
    if (!cell) throw new Error('Missing cell')
    if (type === 'insert_table_row' || type === 'insert_table_column')
      applyDocumentEdits(document, [
        { type, paragraphId: cell.id, position: 'after' },
      ])
    else applyDocumentEdits(document, [{ type, paragraphId: cell.id }])
    const zip = await JSZip.loadAsync(await serialiseDocx(document))
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    if (type === 'delete_table') {
      expect(xml).not.toContain(`w14:paraId="${cell.sourceParaId}"`)
      return
    }
    const table = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/u)?.[0] ?? ''
    expect(table.match(/<w:tr\b/gu) ?? []).toHaveLength(rows)
    expect(table.match(/<w:tc\b/gu) ?? []).toHaveLength(rows * columns)
    expect(table.match(/<w:gridCol\b/gu) ?? []).toHaveLength(columns)
    const ids = [...table.matchAll(/w14:paraId="([^"]+)"/gu)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
}
