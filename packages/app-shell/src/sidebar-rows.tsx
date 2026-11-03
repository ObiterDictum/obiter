import { Link } from '@tanstack/react-router'
import { matterInitials, type MatterRecord } from './matters'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import type { ReactElement, ReactNode, Ref } from 'react'
import { ShortcutHint, type ShellCommand } from './shell-shortcuts'

type IconComponent = (props: {
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
  'aria-hidden'?: boolean
}) => ReactNode

function countNote(label: string, count?: number) {
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

export function ModuleRow({
  label,
  to,
  icon: Icon,
  count,
  alertTone,
  current,
}: {
  label: string
  to: string
  icon: IconComponent
  count?: number
  alertTone?: 'danger' | 'warning' | 'success'
  current?: boolean
}) {
  const note = countNote(label, count)
  const toneClass = countToneClass(label, alertTone)
  return (
    <Link
      to={to}
      aria-label={note ? `${label}, ${note}` : label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-meta',
        'transition-colors duration-150',
        current
          ? 'bg-fill font-medium text-ink'
          : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      <Icon size={16} weight={current ? 'fill' : 'regular'} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {alertTone === 'danger' && count ? (
        <span aria-hidden className="size-1.5 rounded-pill bg-danger" />
      ) : null}
      {count ? (
        <span
          aria-hidden
          className={cn('text-caption tabular-nums', toneClass)}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}

export function RailItem({
  label,
  to,
  icon: Icon,
  count,
  alertTone,
  current,
  shortcut,
  onClick,
  expanded,
  actionRef,
}: {
  label: string
  to?: string
  icon: IconComponent
  count?: number
  alertTone?: 'danger' | 'warning' | 'success'
  current?: boolean
  shortcut: ShellCommand
  onClick?: () => void
  expanded?: boolean
  actionRef?: Ref<HTMLButtonElement>
}) {
  const note = countNote(label, count)
  const control = (
    <>
      <Icon size={18} weight={current ? 'fill' : 'regular'} aria-hidden />
      {alertTone === 'danger' && count ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-1.5 rounded-pill bg-danger"
        />
      ) : null}
    </>
  )
  const className = cn(
    'relative grid size-9 place-items-center rounded-lg',
    'transition-colors duration-150',
    current ? 'bg-fill text-ink' : 'text-muted hover:bg-hover hover:text-ink',
  )
  const accessibleName = note ? `${label}, ${note}` : label
  const tooltip = (
    <>
      <span className="flex items-center gap-2">
        {label}
        <ShortcutHint command={shortcut} />
      </span>
      {note ? <span className="mt-1 block text-subtle">{note}</span> : null}
    </>
  )

  if (onClick) {
    const button = (
      <button
        type="button"
        ref={actionRef}
        aria-label={accessibleName}
        aria-expanded={expanded}
        onClick={onClick}
        className={className}
      >
        {control}
      </button>
    )
    return <RailTooltip content={tooltip}>{button}</RailTooltip>
  }

  const link = (
    <Link
      to={to ?? '/'}
      aria-label={accessibleName}
      aria-current={current ? 'page' : undefined}
      className={className}
    >
      {control}
    </Link>
  )
  return <RailTooltip content={tooltip}>{link}</RailTooltip>
}

function RailTooltip({
  content,
  children,
}: {
  content: ReactNode
  children: ReactElement<Record<string, unknown>>
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" className="max-md:hidden">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export function MatterRow({
  matter,
  current,
}: {
  matter: MatterRecord
  current: boolean
}) {
  return (
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
        'flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5',
        'transition-colors duration-150 hover:bg-hover',
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
          <span className="mt-0.5 block truncate text-caption text-subtle">
            {matter.clientReference}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
