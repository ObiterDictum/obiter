import type { DocumentParagraphWire } from '@obiter/contracts'
import {
  OoxmlError,
  parseXmlElements,
  isWord,
  transformTableXml,
  WORD_NAMESPACE,
  attributeValue,
  type TableStructureOperation,
} from '@obiter/ooxml'

export function foldTableStructure(
  fragments: string[],
  paragraphs: DocumentParagraphWire[],
  operation: TableStructureOperation,
  nextId: () => string,
) {
  const paragraph = paragraphs.find((p) => p.id === operation.paragraphId)
  if (!paragraph?.sourceParaId)
    throw new OoxmlError(
      'model-node-not-editable',
      'Save the table before changing its structure',
    )
  const index = fragments.findIndex(
    (f) =>
      f.includes(`w14:paraId="${paragraph.sourceParaId}"`) &&
      /<w:tbl\b/u.test(f),
  )
  const fragment = fragments[index]
  if (!fragment)
    throw new OoxmlError(
      'model-node-not-editable',
      'The selected table was not found',
    )
  const source = `<w:body xmlns:w="${WORD_NAMESPACE}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">${fragment}</w:body>`
  const elements = parseXmlElements(source)
  const anchor = elements.find(
    (e) =>
      isWord(e, 'p') &&
      attributeValue(
        e,
        'http://schemas.microsoft.com/office/word/2010/wordml',
        'paraId',
      ) === paragraph.sourceParaId,
  )
  let cell = anchor?.parent
  while (cell && !isWord(cell, 'tc')) cell = cell.parent
  const row = cell?.parent
  const table = row?.parent
  if (!cell || !row || !table)
    throw new OoxmlError('model-node-not-editable', 'Select a table cell')
  const result = transformTableXml(
    source,
    elements,
    table,
    row,
    cell,
    operation,
    nextId,
  )
  const oldIds = new Set(
    [...fragment.matchAll(/w14:paraId="([^"]+)"/gu)].map((m) => m[1]),
  )
  const start = paragraphs.findIndex((p) => oldIds.has(p.sourceParaId ?? ''))
  const old = new Map(paragraphs.map((p) => [p.sourceParaId, p]))
  const wires = result.paragraphIds.map(
    (id) =>
      old.get(id) ?? {
        id: `para-w14-${id}`,
        sourceParaId: id,
        runs: [],
        preservedXmlFragments: [],
      },
  )
  const retained = paragraphs.filter((p) => !oldIds.has(p.sourceParaId ?? ''))
  retained.splice(start, 0, ...wires)
  paragraphs.splice(0, paragraphs.length, ...retained)
  fragments.splice(index, 1, ...(result.xml ? [result.xml] : []))
}
