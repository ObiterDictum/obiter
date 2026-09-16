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

// Wheel events arrive in pixels, lines or pages. A line is one mouse-wheel
// notch; 16px per notch keeps a wheel's travel close to the rendered row height.
const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const WHEEL_LINE_HEIGHT = 16

/**
 * The horizontal distance a wheel event should move the mode rail, or null when
 * the browser must keep the event. Separated from the listener so the delta
 * modes and the gestures we must not consume are unit-tested directly.
 */
export function wheelScrollDelta(
  wheel: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  viewportWidth: number,
): number | null {
  // Pinch-zoom arrives as ctrl+wheel. Browser zoom is not ours to consume.
  if (wheel.ctrlKey) return null
  // A trackpad's horizontal gesture must scroll the rail natively; only a
  // vertical-dominant wheel is translated.
  if (Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null
  if (wheel.deltaMode === WHEEL_DELTA_LINE) {
    return wheel.deltaY * WHEEL_LINE_HEIGHT
  }
  if (wheel.deltaMode === WHEEL_DELTA_PAGE) {
    return wheel.deltaY * viewportWidth
  }
  return wheel.deltaY
}

/**
 * Primary mode navigation. The rail is contained and scrolls horizontally when
 * the header cannot fit every mode: without that, the four controls widened the
 * header past the viewport and drew over the account controls at narrow widths.
 * The scrollbar is hidden because a visible bar reserves layout height inside
 * the 44px header that the 32px mode controls already fill. A vertical wheel is
 * translated into horizontal scroll instead, so an ordinary mouse reaches every
 * clipped mode; `onFocus` still brings a keyboard-revealed mode fully inside.
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

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    // Chromium leaves a vertical wheel over an `overflow-x` container to the
    // page, and with the scrollbar hidden that left a mouse user no way to
    // reach a clipped mode. Translate it here. React's `onWheel` is passive,
    // where `preventDefault()` is ignored and the page would scroll as well, so
    // this is a native non-passive listener.
    function onWheel(event: WheelEvent) {
      const rail = railRef.current
      if (!rail) return

      const delta = wheelScrollDelta(event, rail.clientWidth)
      if (delta === null) return

      const max = rail.scrollWidth - rail.clientWidth
      const next = Math.max(0, Math.min(max, rail.scrollLeft + delta))
      // At either end leave the event alone: the page keeps scrolling instead of
      // the rail swallowing a gesture it cannot use.
      if (next === rail.scrollLeft) return

      event.preventDefault()
      rail.scrollLeft = next
    }

    rail.addEventListener('wheel', onWheel, { passive: false })
    return () => rail.removeEventListener('wheel', onWheel)
  }, [])

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
