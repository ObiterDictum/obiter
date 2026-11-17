import { Skeleton, cn } from '@obiter/ui'
import type { IntegrationStatus } from '../integrations-catalogue'

const LABELS = {
  connected: 'Connected',
  available: 'Available',
  planned: 'Planned',
  checking: 'Checking',
} as const satisfies Record<IntegrationStatus, string>

const DOTS = {
  connected: 'bg-success',
  available: 'bg-brand',
  planned: 'bg-line-strong',
  checking: 'bg-line-strong',
} as const satisfies Record<IntegrationStatus, string>

const TONES = {
  connected: 'text-success',
  available: 'text-brand',
  planned: 'text-subtle',
  checking: 'text-subtle',
} as const satisfies Record<IntegrationStatus, string>

export function IntegrationStatusBadge({
  status,
}: {
  status: IntegrationStatus
}) {
  if (status === 'checking') return <Skeleton className="h-6 w-20" />
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-caption whitespace-nowrap',
        status === 'connected' && 'bg-success-soft text-success',
        status === 'available' && 'bg-brand-soft text-ink',
        status === 'planned' && 'bg-fill text-muted',
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-pill', DOTS[status])} />
      {LABELS[status]}
    </span>
  )
}

export function IntegrationStatusChip({
  status,
  className,
}: {
  status: IntegrationStatus
  className?: string
}) {
  if (status === 'checking') return <Skeleton className="h-4 w-16" />
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-caption whitespace-nowrap',
        TONES[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-pill', DOTS[status])}
      />
      <span>{LABELS[status]}</span>
    </span>
  )
}
