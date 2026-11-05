import { expect, it } from 'bun:test'
import { parseXmlElements } from './parts/overlay'
import { isWord } from './parts/xml-elements'
import {
  transformTableXml,
  type TableStructureOperation,
} from './table-structure-edits'

function transform(cells: string, operation: TableStructureOperation) {
  const source = `<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl></w:body>`
  const elements = parseXmlElements(source)
  const table = elements.find((e) => isWord(e, 'tbl'))
  const row = elements.find((e) => isWord(e, 'tr'))
  const cell = elements.find((e) => isWord(e, 'tc'))
  if (!table || !row || !cell) throw new Error('Missing fixture')
  return transformTableXml(
    source,
    elements,
    table,
    row,
    cell,
    operation,
    () => '00000001',
  ).xml
}
const cells =
  '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc>'
it('deleting a column through a horizontal merge shrinks the span and grid together', () => {
  const xml = transform(cells, {
    type: 'delete_table_column',
    paragraphId: 'p',
  })
  expect(xml).toContain('<w:gridSpan w:val="1"/>')
  expect(xml.match(/<w:gridCol\b/gu)).toHaveLength(2)
  expect(xml.match(/<w:tc>/gu)).toHaveLength(2)
})
it('inserting a row copies horizontal merges and creates a fresh paragraph for every cell', () => {
  const xml = transform(cells, {
    type: 'insert_table_row',
    paragraphId: 'p',
    position: 'after',
  })
  expect(xml.match(/<w:gridSpan w:val="2"/gu)).toHaveLength(2)
  expect(xml.match(/<w:tr>/gu)).toHaveLength(2)
})
it('refuses row edits across vertical merges with a clear reason', () => {
  expect(() =>
    transform(
      cells.replace('<w:gridSpan', '<w:vMerge w:val="restart"/><w:gridSpan'),
      { type: 'insert_table_row', paragraphId: 'p', position: 'before' },
    ),
  ).toThrow('Rows crossing vertical merges cannot safely be changed')
})
