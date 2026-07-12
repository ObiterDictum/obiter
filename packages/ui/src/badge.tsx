import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export type BadgeTone =
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-muted border-line',
  brand: 'bg-brand text-brand-fg border-transparent',
  info: 'bg-info text-info-fg border-transparent',
  success: 'bg-success text-success-fg border-transparent',
  warning: 'bg-warning text-warning-fg border-transparent',
  danger: 'bg-danger text-danger-fg border-transparent',
}

/** Badge — a compact status/label pill. Use tones for semantic meaning only. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5',
        'text-xs font-medium leading-5 whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
