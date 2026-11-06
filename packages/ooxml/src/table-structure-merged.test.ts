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

function vertical(operation: TableStructureOperation, selected = 0) {
  const rows = ['restart', '', '']
    .map(
      (value) =>
        `<w:tr><w:tc><w:tcPr><w:vMerge${value ? ` w:val="${value}"` : ''}/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>`,
    )
    .join('')
  const source = `<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>${rows}</w:tbl></w:body>`
  const elements = parseXmlElements(source)
  const table = elements.find((e) => isWord(e, 'tbl'))
  const row = elements.filter((e) => isWord(e, 'tr'))[selected]
  const cell = elements.find((e) => e.parent === row && isWord(e, 'tc'))
  if (!table || !row || !cell) throw new Error('Missing fixture')
  let id = 0
  return transformTableXml(source, elements, table, row, cell, operation, () =>
    String(++id).padStart(8, '0'),
  ).xml
}

it('inserting inside a vertical merge adds a continuation row', () => {
  const xml = vertical({
    type: 'insert_table_row',
    paragraphId: 'p',
    position: 'after',
  })
  expect(xml.match(/<w:vMerge/g)).toHaveLength(4)
  expect(xml.match(/w:val="restart"/g)).toHaveLength(1)
  expect(xml.match(/<w:tr>/g)).toHaveLength(4)
})

it('inserting at either edge of a vertical merge creates unmerged cells', () => {
  for (const [position, selected] of [
    ['before', 0],
    ['after', 2],
  ] as const) {
    const xml = vertical(
      { type: 'insert_table_row', paragraphId: 'p', position },
      selected,
    )
    expect(xml.match(/<w:vMerge/g)).toHaveLength(3)
    expect(xml.match(/<w:tr>/g)).toHaveLength(4)
  }
})

it('deleting a restart row promotes the next continuation to restart', () => {
  const xml = vertical({ type: 'delete_table_row', paragraphId: 'p' })
  expect(xml.match(/<w:vMerge/g)).toHaveLength(2)
  expect(xml.match(/w:val="restart"/g)).toHaveLength(1)
  expect(xml.indexOf('restart')).toBeLessThan(xml.indexOf('</w:tr>'))
})

it('deleting a column through a vertical merge removes its cells and grid column', () => {
  const xml = vertical({ type: 'delete_table_column', paragraphId: 'p' })
  expect(xml).not.toContain('vMerge')
  expect(xml.match(/<w:gridCol/g)).toHaveLength(1)
  expect(xml.match(/<w:tc>/g)).toHaveLength(3)
})
