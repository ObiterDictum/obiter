import { Link } from '@tanstack/react-router'
import { buttonClassName, cn } from '@obiter/ui'
import { ArrowRight } from '@obiter/ui/icons'
import type { CSSProperties } from 'react'
import type { Integration, IntegrationStatus } from '../integrations-catalogue'
import { IntegrationStatusChip } from './integration-status'
import { IntegrationTile, integrationHex } from './integration-tile'

interface CardStyle extends CSSProperties {
  '--card-ring': string
}

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
  const planned = status === 'planned'
  const connect = status === 'available' && canConnect
  const style: CardStyle = {
    '--card-ring': `color-mix(in srgb, ${integrationHex(integration)} 38%, transparent)`,
  }

  return (
    <article
      style={style}
      className="group relative flex h-full flex-col gap-2.5 rounded-lg bg-surface p-4 shadow-sm ring-1 ring-line transition-[background-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:bg-raised hover:shadow-md hover:ring-(--card-ring) has-focus-visible:ring-(--card-ring)"
    >
      <Link
        to="/settings"
        search={integrationSearch(integration)}
        aria-label={`Open ${integration.name}`}
        className="absolute inset-0 z-[1] rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="pointer-events-none relative z-[2] flex items-start gap-2.5">
        <IntegrationTile
          integration={integration}
          tone={planned ? 'quiet' : 'solid'}
        />
        <h4 className="line-clamp-2 min-w-0 flex-1 pt-0.5 text-item leading-tight font-semibold break-words text-ink">
          {integration.name}
        </h4>
      </div>
      <p
        className={cn(
          'pointer-events-none relative z-[2] line-clamp-2 min-h-[2lh] text-caption',
          planned ? 'text-subtle' : 'text-muted',
        )}
      >
        {integration.summary}
      </p>
      <div className="relative z-[2] mt-auto flex items-center justify-between gap-2 pt-1">
        <IntegrationStatusChip status={status} />
        {connect ? (
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
        ) : (
          <span className="pointer-events-none inline-flex items-center gap-1 text-caption text-subtle transition-colors duration-200 group-hover:text-ink">
            <span aria-hidden>Open</span>
            <ArrowRight
              size={12}
              aria-hidden
              className="-translate-x-1 opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100"
            />
          </span>
        )}
      </div>
    </article>
  )
}
