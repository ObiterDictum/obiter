import { Link } from '@tanstack/react-router'
import { matterInitials, type MatterRecord } from './matters'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import type { ReactElement, ReactNode, Ref } from 'react'

export function ModuleRow({
  label,
  to,
  icon: Icon,
  count,
  alertTone,
  current,
  collapsed,
  onClick,
  expanded,
  actionRef,
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
  alertTone?: 'danger' | 'warning' | 'success'
  current?: boolean
  collapsed: boolean
  onClick?: () => void
  expanded?: boolean
  actionRef?: Ref<HTMLButtonElement>
}) {
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
    </>
  )
  const rowClass = cn(
    'flex h-9 items-center gap-3 rounded-md text-item',
    'transition-colors duration-150',
    collapsed ? 'relative mx-auto w-10 justify-center' : 'px-3',
    current
      ? 'bg-brand-soft font-medium text-ink'
      : 'text-muted hover:bg-hover hover:text-ink',
  )
  const badge =
    collapsed && count && toneClass !== 'text-subtle' ? (
      <span
        aria-hidden
        className={cn(
          'absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-pill px-1',
          'text-[10px] leading-none font-medium tabular-nums',
          toneClass === 'text-danger'
            ? 'bg-danger text-danger-fg'
            : toneClass === 'text-warning'
              ? 'bg-warning text-warning-fg'
              : 'bg-info text-info-fg',
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
    ) : null

  if (onClick) {
    const button = (
      <button
        type="button"
        ref={actionRef}
        aria-label={accessibleName}
        aria-expanded={expanded}
        onClick={onClick}
        className={cn(rowClass, 'w-full text-left')}
      >
        {body}
        {badge}
      </button>
    )
    return collapsed ? (
      <RailTooltip label={tooltipLabel(label, countNote)}>{button}</RailTooltip>
    ) : (
      button
    )
  }

  if (!to) {
    return (
      <span aria-disabled="true" className={cn(rowClass, 'text-subtle')}>
        {body}
      </span>
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
      {badge}
    </Link>
  )
  return collapsed ? (
    <RailTooltip label={tooltipLabel(label, countNote)}>{row}</RailTooltip>
  ) : (
    row
  )
}

function tooltipLabel(label: string, countNote: string | null) {
  return countNote ? `${label} · ${countNote}` : label
}

function RailTooltip({
  label,
  children,
}: {
  label: string
  children: ReactElement<Record<string, unknown>>
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function countToneLabel(label: string, count?: number) {
  if (!count) return null
  if (label === 'Matters') return `${count} active`
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
          'grid size-7 shrink-0 place-items-center rounded-md text-caption tracking-tight',
          current ? 'bg-brand-soft text-ink' : 'bg-inset text-muted',
        )}
      >
        {matterInitials(matter)}
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-meta',
              current ? 'text-ink' : 'text-muted',
            )}
            title={matter.name}
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
