import type { DocumentModelWire } from '@obiter/contracts'
import type { PendingRedlines } from './document-pending-redlines'
import type { ExtraRuns } from './document-word-edits'
import type { ColumnFrame } from './document-page-layout'
import {
  tableHeight,
  type PageSession,
  type LaidOutBlock,
} from './document-page-blocks'
import type { DisplayTable } from './document-page-tables'

export function layoutTable(
  table: DisplayTable,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  session: PageSession,
  column: () => ColumnFrame,
  advance: () => void,
  pendingRedlines?: PendingRedlines,
  beforePlace?: (block: LaidOutBlock) => boolean,
): void {
  const headers: DisplayTable['rows'] = []
  for (const row of table.rows) {
    if (!row.header) break
    headers.push(row)
  }
  const height = (rows: DisplayTable['rows']) =>
    tableHeight(
      { ...table, rows },
      model,
      drafts,
      extraRuns,
      column().widthPx,
      undefined,
      pendingRedlines,
    )
  let rows: DisplayTable['rows'] = []
  const flush = () => {
    if (rows.length === 0) return
    session.page.blocks.push({
      type: 'table',
      column: session.col,
      table: {
        ...table,
        rows,
        paragraphIds: rows.flatMap((row) =>
          row.cells.flatMap((cell) => cell.paragraphIds),
        ),
      },
    })
    rows = []
  }
  for (const row of table.rows) {
    while (
      beforePlace &&
      !beforePlace({
        type: 'table',
        table: {
          ...table,
          rows: [row],
          paragraphIds: row.cells.flatMap((cell) => cell.paragraphIds),
        },
      })
    ) {
      flush()
      advance()
    }
    let rowHeight = height([row])
    if (session.y > 0 && session.y + rowHeight > session.page.frame.heightPx) {
      flush()
      advance()
      rowHeight = height([row])
      const headerHeight = height(headers)
      if (
        !headers.includes(row) &&
        headerHeight + rowHeight <= session.page.frame.heightPx
      ) {
        rows = [...headers]
        session.y += headerHeight
      }
    }
    rows.push(row)
    session.y += rowHeight
    if (session.y >= session.page.frame.heightPx) {
      flush()
      advance()
    } else if (
      session.y === rowHeight &&
      !headers.includes(row) &&
      rows.length === 1
    ) {
      const headerHeight = height(headers)
      if (
        headerHeight + rowHeight <= session.page.frame.heightPx &&
        table.rows[0] !== row
      ) {
        rows = [...headers, row]
        session.y += headerHeight
      }
    }
  }
  flush()
}
