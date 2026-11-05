import type {
  DocumentEditOperation,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { parseXmlElements, setOverlayReplacement } from './parts/overlay'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { nextSyntheticParaId } from './structure-package'

export type TableStructureOperation = Extract<
  DocumentEditOperation,
  {
    type:
      | 'insert_table_row'
      | 'insert_table_column'
      | 'delete_table_row'
      | 'delete_table_column'
      | 'delete_table'
  }
>

export function editTableStructure(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  operation: TableStructureOperation,
) {
  const part = requireEditablePart(document, anchor.partName)
  const source = part.overlay.source
  const elements = parseXmlElements(source)
  let cell = elements.find(
    (e) => e.start === anchor.paragraphRange.start,
  )?.parent
  while (cell && !isWord(cell, 'tc')) cell = cell.parent
  const row = cell?.parent
  const table = row?.parent
  if (
    !cell ||
    !row ||
    !table ||
    !isWord(row, 'tr') ||
    !isWord(table, 'tbl') ||
    !table.parent ||
    !isWord(table.parent, 'body')
  ) {
    throw new OoxmlError(
      'model-node-not-editable',
      'Select a cell in a top-level table',
    )
  }
  const key = `table-structure-${String(table.start)}`
  const pending = part.overlay.replacements.get(key)
  for (const [replacementKey, replacement] of part.overlay.replacements) {
    if (replacementKey === key) continue
    if (replacement.start < table.end && replacement.end > table.start) {
      throw new OoxmlError(
        'model-node-not-editable',
        'Save pending edits to this table before changing its structure',
      )
    }
  }
  const currentSource = pending
    ? `<w:body xmlns:w="${WORD_NAMESPACE}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">${pending.value}</w:body>`
    : source
  const currentElements = pending ? parseXmlElements(currentSource) : elements
  const currentParagraph = pending
    ? currentElements.find(
        (e) =>
          isWord(e, 'p') &&
          attributeValue(
            e,
            'http://schemas.microsoft.com/office/word/2010/wordml',
            'paraId',
          ) === anchor.wire.sourceParaId,
      )
    : undefined
  let currentCell = pending ? currentParagraph?.parent : cell
  while (currentCell && !isWord(currentCell, 'tc'))
    currentCell = currentCell.parent
  const currentRow = currentCell?.parent
  const currentTable = currentRow?.parent
  if (!currentCell || !currentRow || !currentTable)
    throw new OoxmlError(
      'model-node-not-editable',
      'The selected cell no longer exists',
    )
  const result = transformTableXml(
    currentSource,
    currentElements,
    currentTable,
    currentRow,
    currentCell,
    operation,
    () => nextSyntheticParaId(part.overlay),
  )
  const story = document.model.stories.find(
    (s) => s.partName === anchor.partName,
  )
  if (!story) throw new OoxmlError('model-node-not-found')
  const oldParagraphs = [...document.paragraphAnchors.values()].filter(
    (p) =>
      p.partName === anchor.partName &&
      p.paragraphRange.start >= table.start &&
      p.paragraphRange.end <= table.end,
  )
  const currentIds = new Set(
    [
      ...currentSource
        .slice(currentTable.start, currentTable.end)
        .matchAll(/w14:paraId="([^"]+)"/gu),
    ].map((m) => m[1]),
  )
  const oldIds = new Set(
    story.paragraphs
      .filter((p) => currentIds.has(p.sourceParaId ?? ''))
      .map((p) => p.id),
  )
  const at = story.paragraphs.findIndex((p) => oldIds.has(p.id))
  const byParaId = new Map(story.paragraphs.map((p) => [p.sourceParaId, p]))
  const paragraphs: DocumentParagraphWire[] = result.paragraphIds.map(
    (id) =>
      byParaId.get(id) ?? {
        id: `para-w14-${id}`,
        sourceParaId: id,
        runs: [],
        preservedXmlFragments: [],
      },
  )
  if (oldParagraphs.some((p) => !p.wire.sourceParaId)) {
    throw new OoxmlError(
      'model-node-not-editable',
      'Save the document to assign stable paragraph identities before changing this table',
    )
  }
  setOverlayReplacement(part.overlay, key, {
    start: table.start,
    end: table.end,
    value: result.xml,
  })
  part.dirty = true
  story.paragraphs = story.paragraphs.filter((p) => !oldIds.has(p.id))
  story.paragraphs.splice(at, 0, ...paragraphs)
  const oldXml = pending?.value ?? source.slice(table.start, table.end)
  story.preservedXmlFragments = story.preservedXmlFragments.flatMap(
    (fragment) =>
      fragment === oldXml ? (result.xml ? [result.xml] : []) : [fragment],
  )
}

export function transformTableXml(
  source: string,
  elements: readonly XmlElement[],
  table: XmlElement,
  row: XmlElement,
  cell: XmlElement,
  operation: TableStructureOperation,
  nextId: () => string,
) {
  const children = (parent: XmlElement, name: string) =>
    elements.filter((e) => e.parent === parent && isWord(e, name))
  const xml = (e: XmlElement) => source.slice(e.start, e.end)
  const rows = children(table, 'tr')
  const grid = children(table, 'tblGrid')[0]
  if (!grid)
    throw new OoxmlError(
      'model-node-not-editable',
      'The table has no column grid',
    )
  const columns = children(grid, 'gridCol')
  const inside = elements.filter(
    (e) => e.start > table.start && e.end < table.end,
  )
  if (
    inside.some((e) =>
      [
        'tbl',
        'gridBefore',
        'gridAfter',
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'tblPrChange',
        'trPrChange',
        'tcPrChange',
      ].some((name) => isWord(e, name)),
    )
  ) {
    throw new OoxmlError(
      'model-node-not-editable',
      'Nested, omitted-grid or tracked table structures are unsafe to change',
    )
  }
  const span = (c: XmlElement) => {
    const property = children(c, 'tcPr')[0]
    const element = property && children(property, 'gridSpan')[0]
    return element ? Number(attributeValue(element, WORD_NAMESPACE, 'val')) : 1
  }
  const matrix = rows.map((r) =>
    children(r, 'tc').map((c) => ({ element: c, span: span(c) })),
  )
  if (
    !columns.length ||
    matrix.some(
      (cells) =>
        cells.some((c) => !Number.isInteger(c.span) || c.span < 1) ||
        cells.reduce((n, c) => n + c.span, 0) !== columns.length,
    )
  ) {
    throw new OoxmlError(
      'model-node-not-editable',
      'The table cells do not match its column grid',
    )
  }
  const rowIndex = rows.indexOf(row)
  const own = matrix[rowIndex] ?? []
  const cellIndex = own.findIndex((c) => c.element === cell)
  const columnIndex = own.slice(0, cellIndex).reduce((n, c) => n + c.span, 0)
  const deleting = operation.type.startsWith('delete_')
  const rowOperation = operation.type.endsWith('_row')
  const removeTable =
    operation.type === 'delete_table' ||
    (deleting && (rowOperation ? rows.length === 1 : columns.length === 1))
  if (removeTable) return { xml: '', paragraphIds: [] }
  const edits: { start: number; end: number; value: string }[] = []
  const add = (e: XmlElement, value: string) =>
    edits.push({ start: e.start, end: e.end, value })
  const insert = (at: number, value: string) =>
    edits.push({ start: at, end: at, value })
  const emptyCell = (c: XmlElement) => {
    const properties = children(c, 'tcPr')[0]
    return `<w:tc>${properties ? xml(properties).replace(/<w:vMerge\b[^>]*(?:\/>|>[\s\S]*?<\/w:vMerge>)/gu, '') : ''}<w:p xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:paraId="${nextId()}"/></w:tc>`
  }
  if (rowOperation) {
    const merge = (c: XmlElement) => {
      const properties = children(c, 'tcPr')[0]
      return properties && children(properties, 'vMerge')[0]
    }
    const aligned = (index: number, column: number, width: number) => {
      let start = 0
      return matrix[index]?.find((c) => {
        const matches = start === column && c.span === width
        start += c.span
        return matches
      })
    }
    if (deleting) {
      add(row, '')
      let column = 0
      for (const c of own) {
        const property = merge(c.element)
        const next = aligned(rowIndex + 1, column, c.span)
        const continuation = next && merge(next.element)
        if (
          property &&
          attributeValue(property, WORD_NAMESPACE, 'val') === 'restart' &&
          continuation &&
          attributeValue(continuation, WORD_NAMESPACE, 'val') !== 'restart'
        )
          add(continuation, '<w:vMerge w:val="restart"/>')
        column += c.span
      }
    } else {
      if (rows.length >= 64)
        throw new OoxmlError(
          'invalid-document-edit',
          'Tables are limited to 64 rows',
        )
      const properties = children(row, 'trPr')[0]
      const boundary =
        'position' in operation && operation.position === 'before'
          ? rowIndex
          : rowIndex + 1
      let column = 0
      const cells = own.map((c) => {
        const below = aligned(boundary, column, c.span)
        const above = aligned(boundary - 1, column, c.span)
        const continuation = below && merge(below.element)
        const extendsMerge =
          above &&
          merge(above.element) &&
          continuation &&
          attributeValue(continuation, WORD_NAMESPACE, 'val') !== 'restart'
        column += c.span
        const value = emptyCell(c.element)
        if (!extendsMerge) return value
        return value.includes('</w:tcPr>')
          ? value.replace('</w:tcPr>', '<w:vMerge/></w:tcPr>')
          : value.replace('<w:tc>', '<w:tc><w:tcPr><w:vMerge/></w:tcPr>')
      })
      insert(
        ('position' in operation ? operation.position : undefined) === 'before'
          ? row.start
          : row.end,
        `<w:tr>${properties ? xml(properties) : ''}${cells.join('')}</w:tr>`,
      )
    }
  } else {
    const boundary =
      columnIndex +
      (!deleting &&
      ('position' in operation ? operation.position : undefined) === 'after'
        ? (own[cellIndex]?.span ?? 1)
        : 0)
    if (!deleting && columns.length >= 64)
      throw new OoxmlError(
        'invalid-document-edit',
        'Tables are limited to 64 columns',
      )
    const gridColumn = columns[columnIndex]
    if (!gridColumn) throw new OoxmlError('invalid-document-edit')
    if (deleting) add(gridColumn, '')
    else insert(columns[boundary]?.start ?? grid.endTagStart, xml(gridColumn))
    for (const cells of matrix) {
      let start = 0
      for (const c of cells) {
        const end = start + c.span
        const affected = deleting
          ? boundary >= start && boundary < end
          : boundary > start && boundary < end
        if (affected) {
          if (deleting && c.span === 1) add(c.element, '')
          else {
            const properties = children(c.element, 'tcPr')[0]
            const property = properties && children(properties, 'gridSpan')[0]
            if (!property) throw new OoxmlError('invalid-document-edit')
            add(
              property,
              `<w:gridSpan w:val="${String(c.span + (deleting ? -1 : 1))}"/>`,
            )
          }
          break
        }
        if (
          !deleting &&
          (boundary === start ||
            (boundary === columns.length && end === boundary))
        ) {
          const newCell = emptyCell(c.element).replace(
            /<w:gridSpan\b[^>]*\/>/u,
            '',
          )
          insert(boundary === start ? c.element.start : c.element.end, newCell)
          break
        }
        start = end
      }
    }
  }
  let output = xml(table)
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output =
      output.slice(0, edit.start - table.start) +
      edit.value +
      output.slice(edit.end - table.start)
  }
  return {
    xml: output,
    paragraphIds: [...output.matchAll(/\bw14:paraId="([^"]+)"/gu)].map(
      (m) => m[1] ?? '',
    ),
  }
}
