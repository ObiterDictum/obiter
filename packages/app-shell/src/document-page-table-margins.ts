import type { DocumentParagraphWire } from '@obiter/contracts'
import { paragraphPlainText } from './document-model-text'
import {
  drawingHasPicture,
  drawingShapeFill,
  paragraphHasImage,
  paragraphImageXml,
} from './document-page-media'
import type { DisplayTable, DisplayTableCell } from './document-page-tables'

export function bindMarginTable(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
  kind: 'header' | 'footer',
): DisplayTable {
  return kind === 'header'
    ? paintEmptyHeaderCells(nestHeaderImages(table, paragraphs), paragraphs)
    : nestFooterContent(table, paragraphs)
}

function paragraphContent(
  paragraphs: DocumentParagraphWire[],
  id: string,
): DocumentParagraphWire | undefined {
  return paragraphs.find((paragraph) => paragraph.id === id)
}

function cellHasContent(
  cell: DisplayTableCell,
  paragraphs: DocumentParagraphWire[],
): boolean {
  return cell.paragraphIds.some((id) => {
    const paragraph = paragraphContent(paragraphs, id)
    if (!paragraph) return false
    return (
      paragraphPlainText(paragraph).trim().length > 0 ||
      paragraphHasImage(paragraph)
    )
  })
}

function nestHeaderImages(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
): DisplayTable {
  if (table.rows.length === 0) return table
  const bound = new Set(
    table.paragraphIds.filter((id) =>
      cellHasContent({ paragraphIds: [id], span: 1 }, paragraphs),
    ),
  )
  const unbound = paragraphs.filter(
    (paragraph) =>
      !bound.has(paragraph.id) &&
      paragraphImageXml(paragraph).some(drawingHasPicture),
  )
  if (unbound.length === 0) return table
  const first = table.rows[0]
  if (!first) return table
  const empty = first.cells
    .map((cell, cellIndex) => ({ cell, cellIndex }))
    .filter(({ cell }) => !cellHasContent(cell, paragraphs))
  if (empty.length === 0) return table
  const target =
    unbound.length === 1 && empty.length >= 2
      ? empty[Math.floor(empty.length / 2)]
      : empty[0]
  const image = unbound[0]
  if (!target || !image) return table
  const rows = table.rows.map((row, rowIndex) => ({
    cells: row.cells.map((cell, cellIndex) =>
      rowIndex === 0 && cellIndex === target.cellIndex
        ? { ...cell, paragraphIds: [image.id] }
        : cellHasContent(cell, paragraphs)
          ? cell
          : { ...cell, paragraphIds: [] },
    ),
  }))
  return {
    ...table,
    rows,
    paragraphIds: rows.flatMap((row) =>
      row.cells.flatMap((cell) => cell.paragraphIds),
    ),
  }
}

const LETTERHEAD_GREY = '#A6A6A6'

function paintEmptyHeaderCells(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
): DisplayTable {
  const equal = withEqualColumns(table)
  const fill =
    paragraphs
      .flatMap((paragraph) =>
        paragraph.runs.flatMap((run) => run.preservedXmlFragments),
      )
      .map(drawingShapeFill)
      .find((value) => value) ??
    (equal.rows[0]?.cells.length === 3 ? LETTERHEAD_GREY : undefined)
  if (!fill) return equal
  const rows = equal.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      if (cell.fill || cellHasContent(cell, paragraphs)) return cell
      return { ...cell, fill, minHeightPx: cell.minHeightPx ?? 48 }
    }),
  }))
  return {
    ...equal,
    rows,
    paragraphIds: rows.flatMap((row) =>
      row.cells.flatMap((cell) => cell.paragraphIds),
    ),
  }
}

function withEqualColumns(table: DisplayTable): DisplayTable {
  const first = table.rows[0]
  if (!first || first.cells.some((cell) => cell.widthPct)) return table
  const widthPct = 100 / first.cells.length
  return {
    ...table,
    rows: table.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        widthPct: cell.widthPct ?? widthPct,
      })),
    })),
  }
}

function nestFooterContent(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
): DisplayTable {
  const storyIds = new Set(paragraphs.map((paragraph) => paragraph.id))
  const matchedText = table.paragraphIds.some((id) => {
    const paragraph = paragraphContent(paragraphs, id)
    return paragraph ? paragraphPlainText(paragraph).trim().length > 0 : false
  })
  if (matchedText && table.paragraphIds.every((id) => storyIds.has(id))) {
    return paintTableFromShapes(table, paragraphs)
  }
  const unusedText = paragraphs.filter(
    (paragraph) => paragraphPlainText(paragraph).trim().length > 0,
  )
  let index = 0
  const rows = table.rows.map((row) => ({
    cells: row.cells.map((cell) => {
      if (cellHasContent(cell, paragraphs)) return cell
      const take = Math.max(cell.paragraphIds.length, 1)
      const paragraphIds = unusedText
        .slice(index, index + take)
        .map((item) => item.id)
      index += take
      return { ...cell, paragraphIds }
    }),
  }))
  return paintTableFromShapes(
    {
      ...table,
      rows,
      paragraphIds: rows.flatMap((row) =>
        row.cells.flatMap((cell) => cell.paragraphIds),
      ),
    },
    paragraphs,
  )
}

function paintTableFromShapes(
  table: DisplayTable,
  paragraphs: DocumentParagraphWire[],
): DisplayTable {
  if (table.rows.some((row) => row.cells.some((cell) => cell.fill)))
    return table
  const fill = paragraphs
    .flatMap((paragraph) =>
      paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    )
    .map(drawingShapeFill)
    .find((value) => value)
  if (!fill) return table
  return {
    ...table,
    rows: table.rows.map((row) => ({
      cells: row.cells.map((cell) => ({ ...cell, fill })),
    })),
  }
}
