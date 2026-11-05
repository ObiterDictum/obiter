import { expect, it } from 'bun:test'
import { buildTableXml } from '@obiter/ooxml'
import { foldTableStructure } from './document-table-structure-fold'
import type { DocumentParagraphWire } from '@obiter/contracts'

it('pending column insertion repaints the grid while preserving existing cell text', () => {
  const fragments = [
    buildTableXml(2, 2, ['00000001', '00000002', '00000003', '00000004']),
  ]
  const paragraphs: DocumentParagraphWire[] = [1, 2, 3, 4].map((n) => ({
    id: `p${n}`,
    sourceParaId: String(n).padStart(8, '0'),
    runs: [{ id: `r${n}`, text: `Cell ${n}`, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }))
  const original = structuredClone({ fragments, paragraphs })
  let counter = 4
  foldTableStructure(
    fragments,
    paragraphs,
    { type: 'insert_table_column', paragraphId: 'p1', position: 'before' },
    () => String(++counter).padStart(8, '0'),
  )
  expect(paragraphs).toHaveLength(6)
  expect(
    paragraphs.filter((p) => p.runs.length).map((p) => p.runs[0]?.text),
  ).toEqual(['Cell 1', 'Cell 2', 'Cell 3', 'Cell 4'])
  expect(fragments[0]?.match(/<w:gridCol\b/gu)).toHaveLength(3)
  expect(original.paragraphs).toHaveLength(4)
})
