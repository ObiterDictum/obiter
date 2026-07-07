import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export interface EmptyStateProps {
  title: ReactNode
  body?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

/** EmptyState — a calm, directive empty surface (no data, no results, not found). */
export function EmptyState({ title, body, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface/60 p-6',
        className,
      )}
    >
      {icon ? <div className="text-subtle">{icon}</div> : null}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {body ? <p className="max-w-prose text-sm leading-relaxed text-muted">{body}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
