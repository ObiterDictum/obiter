import { cn } from '@obiter/ui'
import type { ReactNode } from 'react'
import type { DisplayTable, DisplayTableCell } from '../../document-page-tables'

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
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex} style={row.heightPx ? { height: row.heightPx } : undefined}>
            {row.cells.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                colSpan={cell.span}
                className={cn(
                  'align-middle',
                  cell.fill ? 'p-0' : 'px-1 py-0.5',
                  table.bordered && 'border border-[#c5c1b8]',
                )}
                style={{
                  ...(cell.fill ? { backgroundColor: cell.fill } : {}),
                  ...(cell.widthPct ? { width: `${cell.widthPct}%` } : {}),
                }}
              >
                <div
                  className={cn(
                    'flex h-full w-full flex-col justify-center',
                    cell.fill && 'min-h-12',
                  )}
                  style={
                    cell.minHeightPx ? { minHeight: cell.minHeightPx } : undefined
                  }
                >
                  {renderCell(cell)}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
