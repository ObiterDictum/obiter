import { Badge, Skeleton } from '@obiter/ui'
import type { IntegrationStatus } from '../integrations-catalogue'

const STATUS_LABELS = {
  connected: 'Connected',
  available: 'Available',
  planned: 'Planned',
  checking: 'Checking',
} as const satisfies Record<IntegrationStatus, string>

export function IntegrationStatusBadge({
  status,
}: {
  status: IntegrationStatus
}) {
  if (status === 'checking') return <Skeleton className="h-6 w-20" />
  return (
    <Badge
      tone={
        status === 'connected'
          ? 'success'
          : status === 'available'
            ? 'brand'
            : 'neutral'
      }
    >
      {status === 'connected' ? (
        <span aria-hidden className="size-1.5 rounded-pill bg-success" />
      ) : null}
      {STATUS_LABELS[status]}
    </Badge>
  )
}
