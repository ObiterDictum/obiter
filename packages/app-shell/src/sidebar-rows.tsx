import { Link } from '@tanstack/react-router'
import type { MatterRecord } from './matters'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import type { ReactElement, ReactNode } from 'react'

/** The tile label: the client reference's letters, else the name's initials. */
export function matterTileLabel(matter: MatterRecord): string {
  const reference = matter.clientReference.match(/^[A-Za-z]+/)?.[0]
  if (reference) return reference.slice(0, 3).toUpperCase()
  return matter.name
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

/**
 * The sidebar's two row renderers. They live beside the sidebar rather than in
 * it so each file stays small enough to scan; both read the same collapsed
 * state and the same account of what a count means.
 */

export function ModuleRow({
  label,
  to,
  icon: Icon,
  count,
  alertTone,
  note,
  current,
  collapsed,
}: {
  label: string
  to?: string
  icon: (props: {
    size?: number
    weight?: 'regular' | 'fill'
    className?: string
    'aria-hidden'?: boolean
  }) => ReactNode
  count?: number
  /** Status tone for a module whose count is work waiting on a person. */
  alertTone?: 'danger' | 'warning' | 'success'
  note?: string
  current?: boolean
  collapsed: boolean
}) {
  const disabled = !to
  const countNote = countToneLabel(label, count)
  const toneClass = countToneClass(label, alertTone)
  const accessibleName = countNote ? `${label}, ${countNote}` : label
  const body = (
    <>
      <Icon size={16} weight={current ? 'fill' : 'regular'} aria-hidden />
      {collapsed ? null : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {collapsed || !count ? null : (
        <span
          aria-hidden
          className={cn(
            'text-caption tabular-nums',
            count > 0 ? toneClass : 'text-subtle',
          )}
        >
          {count}
        </span>
      )}
      {collapsed || !note ? null : (
        <span className="text-caption text-subtle">{note}</span>
      )}
    </>
  )
  const rowClass = cn(
    'flex h-9 items-center gap-3 rounded-md text-item',
    'transition-colors duration-150',
    collapsed ? 'relative mx-auto w-10 justify-center' : 'px-3',
    disabled
      ? 'text-subtle'
      : current
        ? 'bg-brand-soft font-medium text-ink'
        : 'text-muted hover:bg-hover hover:text-ink',
  )

  if (disabled || !to) {
    const unavailable = (
      <span aria-disabled="true" className={rowClass}>
        {body}
      </span>
    )
    return collapsed ? (
      <RailTooltip label={accessibleName}>{unavailable}</RailTooltip>
    ) : (
      unavailable
    )
  }

  const row = (
    <Link
      to={to}
      aria-label={accessibleName}
      aria-current={current ? 'page' : undefined}
      className={rowClass}
    >
      {body}
      {/* The rail has no count, so it gets the mock-up's alert dot. The
          expanded row shows the coloured count instead, and its `relative`
          anchor only exists when collapsed — an absolute dot outside that
          lands in the corner of the window. */}
      {collapsed && count && toneClass !== 'text-subtle' ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-1.5 right-2 size-1.5 rounded-pill',
            toneClass === 'text-danger'
              ? 'bg-danger'
              : toneClass === 'text-warning'
                ? 'bg-warning'
                : 'bg-info',
          )}
        />
      ) : null}
    </Link>
  )
  return collapsed ? (
    <RailTooltip label={accessibleName}>{row}</RailTooltip>
  ) : (
    row
  )
}

/**
 * The rail's labels. The tooltip is supplementary: the control's accessible
 * name already carries the label (and its count), so a keyboard or screen
 * reader user never has to hover to know what a row is.
 */
function RailTooltip({
  label,
  children,
}: {
  label: string
  /** A control to anchor the label to; it keeps its own role and name. */
  children: ReactElement<Record<string, unknown>>
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The count's meaning, in the same words the accessible name uses. */
function countToneLabel(label: string, count?: number) {
  if (!count) return null
  if (label === 'Matters') return `${count} active`
  // Findings, not runs: one run can leave several unresolved, and Home shows
  // one queue row for that run.
  if (label === 'Verify')
    return `${count} unresolved ${count === 1 ? 'finding' : 'findings'}`
  if (label === 'Redact') return `${count} waiting`
  return `${count}`
}

function countToneClass(
  label: string,
  alertTone?: 'danger' | 'warning' | 'success',
) {
  if (label === 'Verify')
    return alertTone === 'warning' ? 'text-warning' : 'text-danger'
  if (label === 'Redact') return 'text-info'
  return 'text-subtle'
}

export function MatterRow({
  matter,
  current,
  collapsed,
}: {
  matter: MatterRecord
  current: boolean
  collapsed: boolean
}) {
  const link = (
    <Link
      to="/matters/$matterId"
      params={{ matterId: matter.id }}
      aria-label={
        matter.clientReference
          ? `${matter.name} — ${matter.clientReference}`
          : matter.name
      }
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-md transition-colors duration-150 hover:bg-hover',
        collapsed ? 'mx-auto w-10 justify-center py-1' : 'px-2 py-1',
        current && 'bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-md text-caption',
          current ? 'bg-brand-soft text-ink' : 'bg-inset text-muted',
        )}
      >
        {matterTileLabel(matter)}
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-meta',
              current ? 'text-ink' : 'text-muted',
            )}
          >
            {matter.name}
          </span>
          {matter.clientReference ? (
            <span className="mt-1 block truncate text-caption text-subtle">
              {matter.clientReference}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  )

  return collapsed ? (
    <RailTooltip label={matter.name}>{link}</RailTooltip>
  ) : (
    link
  )
}
