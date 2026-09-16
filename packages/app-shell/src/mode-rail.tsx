import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { cn } from '@obiter/ui'
import { useEffect, useState } from 'react'
import { modeLabel, type ModeId } from './mode-navigation'
import { useModeRailSections, type RailItem } from './mode-rail-sections'
import { ObiterMark } from './wordmark'

/**
 * Left icon rail. Compact at narrow widths: it only expands on hover/focus at
 * `md` and up, because a 256px rail widening a 320px viewport pushed the page
 * past its own edge. The top mode nav carries the labels at narrow widths.
 */
export function ModeRail({ mode }: { mode: ModeId }) {
  const navigate = useNavigate()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const sections = useModeRailSections(mode, currentPath, navigate)
  const expandable = sections.length > 0
  const [navVisible, setNavVisible] = useState(expandable)

  useEffect(() => {
    if (!expandable) {
      setNavVisible(false)
      return
    }
    setNavVisible(false)
    const frame = window.requestAnimationFrame(() => setNavVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [mode, expandable])

  return (
    <aside
      className={cn(
        'group/rail relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-canvas',
        'w-12 transition-[width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
        expandable && 'md:hover:w-64 md:focus-within:w-64',
      )}
      aria-label={expandable ? 'Mode shortcuts' : 'Obiter'}
    >
      {/* Fixed inner width so icons stay left-aligned while the rail clips/expands. */}
      <div className="flex h-full w-64 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Link to="/" aria-label="Home" className="shrink-0">
            <ObiterMark className="h-5 w-5" />
          </Link>
          <span
            className={cn(
              'truncate text-[11px] font-semibold tracking-[0.14em] text-muted uppercase',
              'opacity-0 transition-opacity duration-200',
              expandable &&
                'md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100',
            )}
          >
            {modeLabel(mode)}
          </span>
        </div>

        <nav
          className={cn(
            'flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-3',
            'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            navVisible
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-1 opacity-0',
          )}
          aria-hidden={!expandable}
        >
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-0.5">
              <p
                className={cn(
                  'h-5 overflow-hidden whitespace-nowrap px-2.5 text-[10px] font-medium tracking-wider text-subtle uppercase',
                  'opacity-0 transition-opacity duration-200',
                  'md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100',
                )}
              >
                {section.title}
              </p>
              {section.items.map((item) => (
                <RailItemRow
                  key={item.id}
                  item={item}
                  currentPath={currentPath}
                />
              ))}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function RailItemRow({
  item,
  currentPath,
}: {
  item: RailItem
  currentPath: string
}) {
  const Icon = item.icon
  const active = item.to
    ? item.to === '/'
      ? currentPath === '/'
      : currentPath === item.to || currentPath.startsWith(`${item.to}/`)
    : false
  const rowClass = cn(
    'flex min-h-9 items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-[color,background-color] duration-150',
    item.muted
      ? 'text-subtle'
      : active
        ? 'bg-raised text-ink'
        : 'text-muted hover:bg-raised/70 hover:text-ink',
  )
  const body = (
    <>
      <Icon
        size={18}
        weight={active && !item.muted ? 'fill' : 'regular'}
        className="shrink-0"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{item.label}</span>
        {item.note ? (
          <span className="block truncate text-[10px] text-subtle">
            {item.note}
          </span>
        ) : null}
      </span>
    </>
  )

  if (item.to) {
    return (
      <Link
        to={item.to}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className={rowClass}
      >
        {body}
      </Link>
    )
  }

  if (item.onClick) {
    return (
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        className={rowClass}
        onClick={item.onClick}
      >
        {body}
      </button>
    )
  }

  return (
    <span title={item.label} className={rowClass}>
      {body}
    </span>
  )
}
