import { Link } from '@tanstack/react-router'
import {
  Folders,
  ListChecks,
  MagnifyingGlass,
  PencilSimple,
} from '@phosphor-icons/react'
import { cn } from '@obiter/ui'
import { useEffect, useRef, type ReactNode } from 'react'

export type PhosphorIcon = (props: {
  size?: number
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
  'aria-hidden'?: boolean
}) => ReactNode

interface ModeItem {
  label: string
  to: string
  icon: PhosphorIcon
  status: 'live' | 'soon'
}

const MODE_NAV: ModeItem[] = [
  { label: 'Search', to: '/search', icon: MagnifyingGlass, status: 'live' },
  { label: 'Matters', to: '/matters', icon: Folders, status: 'live' },
  { label: 'Verify', to: '/verify', icon: ListChecks, status: 'soon' },
  { label: 'Redact', to: '/redact', icon: PencilSimple, status: 'live' },
]

export type ModeId =
  'home' | 'search' | 'matters' | 'verify' | 'redact' | 'other'

export function resolveMode(path: string): ModeId {
  if (path === '/') return 'home'
  if (
    path === '/search' ||
    path.startsWith('/case/') ||
    path.startsWith('/cases/')
  )
    return 'search'
  if (path === '/matters' || path.startsWith('/matters/')) return 'matters'
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify'
  if (path === '/redact' || path.startsWith('/redact/')) return 'redact'
  return 'other'
}

export function modeLabel(mode: ModeId) {
  switch (mode) {
    case 'home':
      return 'Home'
    case 'search':
      return 'Search'
    case 'matters':
      return 'Matters'
    case 'verify':
      return 'Verify'
    case 'redact':
      return 'Redact'
    default:
      return 'Obiter'
  }
}

function isModeActive(item: ModeItem, mode: ModeId) {
  return item.to === `/${mode}`
}

/**
 * Primary mode navigation. The rail is contained and scrolls horizontally when
 * the header cannot fit every mode: without that, the four controls widened the
 * header past the viewport and drew over the account controls at narrow widths.
 * The scrollbar is hidden because a visible bar would take a third of the 44px
 * header and clip the controls; wheel, drag, touch and keyboard still scroll.
 */
export function TopModeNav({ mode }: { mode: ModeId }) {
  const railRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Genuine browser sync: after navigation, bring the current mode into view
    // so it is not left off-screen at widths where the rail scrolls. Instant and
    // `block: 'nearest'` so it never scrolls the page vertically.
    railRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [mode])

  return (
    <div
      ref={railRef}
      className={cn(
        'min-w-0 overflow-x-auto py-1 scroll-px-1',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      <nav
        className="flex items-center gap-0.5 px-0.5"
        aria-label="Modes"
        onFocus={(event) => {
          // Keyboard focus must reveal the control fully: the browser leaves a
          // partially visible mode at the rail edge, which clips its focus ring.
          if (event.target instanceof HTMLElement) {
            event.target.scrollIntoView({ inline: 'nearest', block: 'nearest' })
          }
        }}
      >
        {MODE_NAV.map((item) => {
          const active = isModeActive(item, mode)
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-[color,background-color] duration-200',
                active
                  ? 'bg-raised text-ink'
                  : 'text-muted hover:bg-raised/60 hover:text-ink',
              )}
            >
              <Icon
                size={14}
                weight={active ? 'fill' : 'regular'}
                aria-hidden
              />
              {item.label}
              {item.status === 'soon' ? (
                <span className="text-[10px] font-normal text-subtle">
                  Soon
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
