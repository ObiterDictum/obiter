import { useState, type ReactNode } from 'react'
import type { TableStructureOperation } from '@obiter/ooxml'

const commands = [
  ['Insert row above', 'insert_table_row', 'before'],
  ['Insert row below', 'insert_table_row', 'after'],
  ['Insert column left', 'insert_table_column', 'before'],
  ['Insert column right', 'insert_table_column', 'after'],
  ['Delete row', 'delete_table_row'],
  ['Delete column', 'delete_table_column'],
  ['Delete table', 'delete_table'],
] as const

export function TableStructureSurface({
  children,
  unavailable,
  onChange,
}: {
  children: ReactNode
  unavailable?: string
  onChange?: (operation: TableStructureOperation) => void
}) {
  const [menu, setMenu] = useState<{
    x: number
    y: number
    paragraphId: string
  } | null>(null)
  return (
    <div
      className="contents"
      onContextMenu={(event) => {
        if (!(event.target instanceof Element)) return
        const cell = event.target.closest('td')
        const paragraphId = cell
          ?.querySelector('[data-paragraph-id]')
          ?.getAttribute('data-paragraph-id')
        if (!paragraphId) return
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, paragraphId })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMenu(null)
        if (
          event.key !== 'Tab' ||
          event.shiftKey ||
          unavailable ||
          !onChange ||
          !(event.target instanceof Element)
        )
          return
        const cell = event.target.closest('td')
        const table = cell?.closest('table')
        const cells = table?.querySelectorAll('td')
        const paragraphId = cell
          ?.querySelector('[data-paragraph-id]')
          ?.getAttribute('data-paragraph-id')
        if (
          !table ||
          !cells ||
          cells[cells.length - 1] !== cell ||
          !paragraphId
        )
          return
        event.preventDefault()
        onChange({ type: 'insert_table_row', paragraphId, position: 'after' })
        requestAnimationFrame(() => {
          const rows = table.querySelectorAll('tr')
          const first = rows[rows.length - 1]?.querySelector<HTMLElement>(
            '[data-paragraph-id]',
          )
          first?.click()
        })
      }}
    >
      {children}
      {menu && (
        <div
          role="menu"
          aria-label="Table tools"
          className="fixed z-50 rounded border border-line bg-surface p-1 shadow-lg"
          style={{
            left: Math.min(menu.x, window.innerWidth - 220),
            top: Math.min(menu.y, window.innerHeight - 290),
          }}
        >
          {commands.map(([label, type, position]) => (
            <button
              key={label}
              role="menuitem"
              type="button"
              disabled={Boolean(unavailable) || !onChange}
              title={unavailable}
              className="block w-full px-3 py-2 text-left text-sm disabled:opacity-50"
              onClick={() => {
                if (
                  type === 'insert_table_row' ||
                  type === 'insert_table_column'
                )
                  onChange?.({
                    type,
                    position: position ?? 'after',
                    paragraphId: menu.paragraphId,
                  })
                else onChange?.({ type, paragraphId: menu.paragraphId })
                setMenu(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
