import { cn } from '@obiter/ui'
import type { ReactNode } from 'react'
import {
  tablePaintRows,
  type DisplayTable,
  type DisplayTableCell,
} from '../../document-page-tables'

export function PageTable({
  table,
  renderCell,
}: {
  table: DisplayTable
  renderCell: (cell: DisplayTableCell) => ReactNode
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <tbody>
        {tablePaintRows(table).map(({ row, cells }, rowIndex) => (
          <tr
            key={rowIndex}
            style={row.heightPx ? { height: row.heightPx } : undefined}
          >
            {cells.map(({ cell, rowSpan }, cellIndex) => {
              const continued = cell.vMerge === 'continue'
              const fill = continued ? cell.mergeFill : cell.fill
              const vAlign = continued ? cell.mergeVAlign : cell.vAlign
              return (
                <td
                  key={cellIndex}
                  colSpan={cell.span}
                  rowSpan={rowSpan > 1 ? rowSpan : undefined}
                  data-table-cell
                  className={cn(
                    vAlign === 'top'
                      ? 'align-top'
                      : vAlign === 'bottom'
                        ? 'align-bottom'
                        : 'align-middle',
                    fill ? 'p-0' : 'px-1 py-0.5',
                    table.bordered && 'border border-[#c5c1b8]',
                  )}
                  style={{
                    ...(fill ? { backgroundColor: fill } : {}),
                    ...(cell.widthPct ? { width: `${cell.widthPct}%` } : {}),
                  }}
                >
                  <div
                    className={cn(
                      'flex h-full w-full flex-col',
                      vAlign === 'top'
                        ? 'justify-start'
                        : vAlign === 'bottom'
                          ? 'justify-end'
                          : 'justify-center',
                      fill && 'min-h-12',
                    )}
                    style={
                      cell.minHeightPx
                        ? { minHeight: cell.minHeightPx }
                        : undefined
                    }
                  >
                    {continued ? null : renderCell(cell)}
                  </div>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
