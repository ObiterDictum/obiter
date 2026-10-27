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
export function EmptyState({
  title,
  body,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg bg-surface p-8',
        className,
      )}
    >
      {icon ? (
        <div className="grid size-9 place-items-center rounded-md bg-fill text-subtle">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h2 className="text-section text-ink">{title}</h2>
        {body ? (
          <p className="max-w-prose text-meta text-muted">{body}</p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-1 flex items-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
