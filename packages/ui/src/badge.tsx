import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export type BadgeTone =
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}

const toneClasses = {
  neutral: 'bg-fill text-muted',
  brand: 'bg-brand-soft text-ink',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} satisfies Record<BadgeTone, string>

/** Badge — a compact status/label pill. Use tones for semantic meaning only. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-1',
        'text-caption whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
