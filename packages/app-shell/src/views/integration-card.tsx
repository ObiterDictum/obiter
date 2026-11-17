import { Link } from '@tanstack/react-router'
import { buttonClassName } from '@obiter/ui'
import { ArrowRight } from '@obiter/ui/icons'
import type { Integration, IntegrationStatus } from '../integrations-catalogue'
import { IntegrationStatusBadge } from './integration-status'
import { IntegrationTile } from './integration-tile'

export function integrationSearch(integration: Integration) {
  return { section: 'integrations' as const, integration: integration.id }
}

export function IntegrationCard({
  integration,
  status,
  canConnect,
}: {
  integration: Integration
  status: IntegrationStatus
  canConnect: boolean
}) {
  return (
    <div className="group relative flex h-full flex-col gap-4 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-line transition-[background-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:bg-raised hover:shadow-md hover:ring-line-strong">
      <Link
        to="/settings"
        search={integrationSearch(integration)}
        aria-label={`Open ${integration.name}`}
        className="absolute inset-0 z-[1] rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="pointer-events-none relative z-[2] flex items-start justify-between gap-3">
        <IntegrationTile integration={integration} />
        <IntegrationStatusBadge status={status} />
      </div>
      <div className="pointer-events-none relative z-[2] flex flex-col gap-1">
        <h4 className="text-item font-semibold text-ink">{integration.name}</h4>
        <p className="line-clamp-2 text-meta text-muted">
          {integration.summary}
        </p>
      </div>
      {status === 'available' && canConnect ? (
        <div className="relative z-[2] mt-auto">
          <Link
            to="/settings"
            search={integrationSearch(integration)}
            aria-label={`Connect ${integration.name}`}
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: 'gap-1.5',
            })}
          >
            Connect
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      ) : null}
    </div>
  )
}
