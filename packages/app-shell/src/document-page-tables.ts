import type {
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import { paragraphPlainText } from './document-model-text'
import { drawingShapeFill } from './document-page-media'
import { bindMarginTable } from './document-page-table-margins'
import { twipToPx } from './document-page-units'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml'
const TABLE_WRAP = `xmlns:w="${WORD_NS}" xmlns:w14="${WORD_2010_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:v="urn:schemas-microsoft-com:vml"`

export type DisplayTableCell = {
  fill?: string
  span: number
  widthPct?: number
  minHeightPx?: number
  paragraphIds: string[]
  /**
   * The `w:p` count inside the cell, including paragraphs that carry no
   * `w14:paraId`. Positional binding needs it: a legacy cell still owns its
   * terminal paragraph even when no id names it. Populated by the table
   * fragment parser; hand-built cells fall back to `paragraphIds.length`.
   */
  paragraphCount?: number
}

export type DisplayTable = {
  bordered: boolean
  rows: Array<{ cells: DisplayTableCell[]; heightPx?: number }>
  paragraphIds: string[]
}

const TABLE_CELL_PAD_X_PX = 8

export function cellWrapWidthPx(
  cell: DisplayTableCell,
  tableWidthPx: number,
  columnCount = 1,
) {
  const pct = cell.widthPct ?? (columnCount > 0 ? 100 / columnCount : 100)
  const pad = cell.fill ? 0 : TABLE_CELL_PAD_X_PX
  return Math.max(1, Math.round((tableWidthPx * pct) / 100) - pad)
}

export type StoryBlock =
  | { type: 'paragraph'; paragraph: DocumentParagraphWire }
  | { type: 'table'; table: DisplayTable }

export function storyTables(story: DocumentStoryWire): DisplayTable[] {
  return story.preservedXmlFragments
    .map(parseWordTable)
    .filter((table): table is DisplayTable => table !== undefined)
}

export function rowPaintHeight(row: DisplayTable['rows'][number]): number {
  const filled = row.cells.some((cell) => cell.fill)
  const minCell = Math.max(0, ...row.cells.map((cell) => cell.minHeightPx ?? 0))
  const lines = Math.max(
    1,
    ...row.cells.map((cell) => Math.max(1, cell.paragraphIds.length)),
  )
  return Math.max(row.heightPx ?? 0, minCell, lines * 22, filled ? 48 : 28)
}

export function tablePaintHeight(table: DisplayTable): number {
  return table.rows.reduce((sum, row) => sum + rowPaintHeight(row), 0)
}

export function storyBlocks(story: DocumentStoryWire): StoryBlock[] {
  const tables = storyTables(story).map((table) =>
    story.kind === 'header' || story.kind === 'footer'
      ? bindMarginTable(table, story.paragraphs, story.kind)
      : table,
  )
  const used = new Set<string>()
  const placed = new Set<DisplayTable>()
  const blocks: StoryBlock[] = []

  if (story.kind === 'header' || story.kind === 'footer') {
    for (const table of tables) {
      blocks.push({ type: 'table', table })
      placed.add(table)
      for (const id of table.paragraphIds) used.add(id)
      if (story.kind === 'footer') {
        for (const paragraph of story.paragraphs) {
          if (used.has(paragraph.id)) continue
          if (paragraphPlainText(paragraph).trim()) continue
          const fill = paragraph.runs
            .flatMap((run) => run.preservedXmlFragments)
            .some((xml) => drawingShapeFill(xml))
          if (fill) used.add(paragraph.id)
        }
      }
    }
  }

  for (const paragraph of story.paragraphs) {
    if (used.has(paragraph.id)) continue
    const table = tables.find((item) => {
      if (placed.has(item)) return false
      return bindTableParagraphs(
        item,
        story.paragraphs,
        used,
      ).paragraphIds.includes(paragraph.id)
    })
    if (table) {
      const bound = bindTableParagraphs(table, story.paragraphs, used)
      blocks.push({ type: 'table', table: bound })
      placed.add(table)
      for (const id of bound.paragraphIds) used.add(id)
      continue
    }
    used.add(paragraph.id)
    blocks.push({ type: 'paragraph', paragraph })
  }

  return blocks
}

/**
 * The paragraph ids bound inside the story's tables. Cell paragraphs are
 * story paragraphs, but the writer refuses them as anchors — a nested `w:tbl`
 * is not a body-level block — so the ribbon must refuse them too, and the
 * structural fold must know the wire after an insertion site belongs to an
 * existing table. Reads the same `storyBlocks` binding the paint uses, so
 * paraId-less stored tables resolve by position exactly as they render.
 */
export function storyTableCellIds(
  story: DocumentStoryWire | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!story) return ids
  for (const block of storyBlocks(story)) {
    if (block.type !== 'table') continue
    for (const id of block.table.paragraphIds) ids.add(id)
  }
  return ids
}

function bindTableParagraphs(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
  used: Set<string>,
): DisplayTable {
  const available = new Set(
    paragraphs
      .filter((paragraph) => !used.has(paragraph.id))
      .map((paragraph) => paragraph.id),
  )
  if (
    table.paragraphIds.length > 0 &&
    table.paragraphIds.every((id) => available.has(id))
  ) {
    return table
  }
  if (table.paragraphIds.some((id) => available.has(id))) return table

  const unused = paragraphs.filter((paragraph) => !used.has(paragraph.id))
  let index = 0
  const rows = table.rows.map((row) => ({
    cells: row.cells.map((cell) => {
      // Bind every paragraph the cell owns — a cell must end in one — so a
      // legacy table whose cells carry no `w14:paraId` still consumes its
      // wires instead of leaving them to paint as body paragraphs.
      const take = Math.max(
        cell.paragraphCount ?? cell.paragraphIds.length,
        cell.paragraphIds.length,
        1,
      )
      const paragraphIds = unused
        .slice(index, index + take)
        .map((item) => item.id)
      index += take
      return { ...cell, paragraphIds }
    }),
  }))
  return {
    ...table,
    rows,
    paragraphIds: rows.flatMap((row) =>
      row.cells.flatMap((cell) => cell.paragraphIds),
    ),
  }
}

function parseWordTable(xml: string): DisplayTable | undefined {
  if (!xml.includes('<w:tbl')) return undefined
  // A table fragment never carries a DTD. A DOCTYPE or entity declaration is a
  // billion-laughs attempt that `application/xml` would expand before layout,
  // so refuse the fragment rather than parse it.
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) return undefined
  const document = new DOMParser().parseFromString(
    `<root ${TABLE_WRAP}>${tableStructureXml(xml)}</root>`,
    'application/xml',
  )
  if (document.querySelector('parsererror')) return undefined
  const tbl = local(document.documentElement, 'tbl')[0]
  if (!tbl) return undefined

  const tableFill = shdFill(children(children(tbl, 'tblPr')[0], 'shd')[0])
  const columnPcts = gridColumnPcts(children(tbl, 'tblGrid')[0])
  const rows = tableRows(tbl).map((tr) => {
    let column = 0
    const heightPx = rowHeightPx(tr)
    return {
      ...(heightPx ? { heightPx } : {}),
      cells: tableCells(tr).map((tc) => {
        const tcPr = children(tc, 'tcPr')[0]
        const spanEl = tcPr ? children(tcPr, 'gridSpan')[0] : undefined
        const span = Number(attr(spanEl, 'val') ?? '1')
        const safeSpan = Number.isFinite(span) && span > 0 ? span : 1
        const fill =
          shdFill(tcPr ? children(tcPr, 'shd')[0] : undefined) ?? tableFill
        const widthPct = columnPcts
          .slice(column, column + safeSpan)
          .reduce((sum, value) => sum + value, 0)
        column += safeSpan
        return {
          span: safeSpan,
          paragraphIds: paragraphIdsInCell(tc),
          paragraphCount: paragraphCountInCell(tc),
          ...(fill ? { fill } : {}),
          ...(widthPct > 0 ? { widthPct } : {}),
          ...(heightPx ? { minHeightPx: heightPx } : {}),
        }
      }),
    }
  })

  const paragraphIds = rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.paragraphIds),
  )
  if (rows.length === 0) return undefined
  return {
    bordered: xml.includes('<w:tblBorders') || xml.includes('<w:tcBorders'),
    rows,
    paragraphIds,
  }
}

function tableStructureXml(xml: string) {
  return xml
    .replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/gi, '')
    .replace(/<w:pict\b[\s\S]*?<\/w:pict>/gi, '')
}

function tableRows(tbl: Element): Element[] {
  return local(tbl, 'tr').filter((row) => nearest(row, 'tbl') === tbl)
}

function tableCells(row: Element): Element[] {
  return local(row, 'tc').filter((cell) => nearest(cell, 'tr') === row)
}

function gridColumnPcts(grid: Element | undefined): number[] {
  if (!grid) return []
  const widths = children(grid, 'gridCol').map((column) =>
    Number(attr(column, 'w') ?? '0'),
  )
  const total = widths.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []
  return widths.map((value) => (value / total) * 100)
}

function rowHeightPx(row: Element): number | undefined {
  const height = children(children(row, 'trPr')[0], 'trHeight')[0]
  const value = Number(attr(height, 'val') ?? '')
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.max(1, Math.round(twipToPx(value)))
}

function shdFill(shd: Element | undefined): string | undefined {
  const fill = hexFill(attr(shd, 'fill'))
  if (fill) return fill
  const theme = attr(shd, 'themeFill')?.toLowerCase()
  if (theme === 'dk1' || theme === 'dk2') return '#3A3A3A'
  if (theme === 'bg2' || theme === 'lt2') return '#A6A6A6'
  return undefined
}

function paragraphIdsInCell(cell: Element): string[] {
  return cellParagraphs(cell)
    .map((paragraph) => attr(paragraph, 'paraId'))
    .filter((id): id is string => Boolean(id))
    .map((id) => `para-w14-${id}`)
}

function paragraphCountInCell(cell: Element): number {
  return cellParagraphs(cell).length
}

function cellParagraphs(cell: Element): Element[] {
  return [...cell.getElementsByTagName('*')].filter(
    (element) => element.localName === 'p' && nearest(element, 'tc') === cell,
  )
}

function hexFill(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === 'auto' || value.toLowerCase() === 'nil')
    return undefined
  if (!/^[0-9A-Fa-f]{6}$/.test(value)) return undefined
  return `#${value}`
}

function children(parent: Element | undefined, localName: string): Element[] {
  if (!parent) return []
  return [...parent.children].filter((child) => child.localName === localName)
}

function local(parent: Element, localName: string): Element[] {
  return [...parent.getElementsByTagName('*')].filter(
    (element) => element.localName === localName,
  )
}

function nearest(element: Element, localName: string): Element | undefined {
  let current: Element | null = element.parentElement
  while (current) {
    if (current.localName === localName) return current
    current = current.parentElement
  }
  return undefined
}

function attr(
  element: Element | undefined,
  localName: string,
): string | undefined {
  if (!element) return undefined
  for (const attribute of element.attributes) {
    if (attribute.localName === localName) return attribute.value
  }
  return undefined
}
