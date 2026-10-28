import { cn } from './lib/cn'

export interface StatusDotProps {
  /** The visible status word. Required: colour alone must never carry status. */
  children: string
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  className?: string
}

const dotTones = {
  neutral: 'bg-subtle',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} satisfies Record<NonNullable<StatusDotProps['tone']>, string>

/** StatusDot — a quiet dot plus its status word, readable without colour. */
export function StatusDot({
  children,
  tone = 'neutral',
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-meta text-ink',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-pill', dotTones[tone])}
      />
      {children}
    </span>
  )
}
