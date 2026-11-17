import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { ArrowRight, ShareNetwork } from '@obiter/ui/icons'
import type { Integration } from '../integrations-catalogue'
import { integrationSearch } from './integration-card'
import { IntegrationRule } from './integration-rule'
import { IntegrationStatusBadge } from './integration-status'
import { IntegrationTile, brandWash, integrationHex } from './integration-tile'

interface FeaturedStyle extends CSSProperties {
  '--card-ring': string
}

export interface ConnectedIntegration {
  integration: Integration
  facts: readonly string[]
}

export function ConnectedStrip({
  connected,
  firstAvailable,
}: {
  connected: readonly ConnectedIntegration[]
  firstAvailable: Integration | undefined
}) {
  if (connected.length === 0) {
    return <ConnectedEmpty firstAvailable={firstAvailable} />
  }
  return (
    <section
      aria-labelledby="integrations-connected-heading"
      className="flex flex-col gap-3"
    >
      <IntegrationRule
        id="integrations-connected-heading"
        label="Connected"
        count={connected.length}
      />
      <ul className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-2">
        {connected.map(({ integration, facts }) => (
          <li key={integration.id} className="min-w-0 @[40rem]:only:col-span-2">
            <ConnectedCard integration={integration} facts={facts} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConnectedCard({
  integration,
  facts,
}: {
  integration: Integration
  facts: readonly string[]
}) {
  const style: FeaturedStyle = {
    backgroundImage: brandWash(integration, '12%'),
    '--card-ring': `color-mix(in srgb, ${integrationHex(integration)} 32%, transparent)`,
  }
  return (
    <article
      style={style}
      className="group relative flex h-full items-center gap-3.5 overflow-hidden rounded-lg bg-surface p-4 shadow-sm ring-1 ring-line transition-[box-shadow] duration-200 hover:shadow-md hover:ring-(--card-ring)"
    >
      <Link
        to="/settings"
        search={integrationSearch(integration)}
        aria-label={`Open ${integration.name}`}
        className="absolute inset-0 z-[1] rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <IntegrationTile integration={integration} size="featured" />
      <div className="pointer-events-none relative z-[2] min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-item font-semibold text-ink">
            {integration.name}
          </h4>
          <IntegrationStatusBadge status="connected" />
        </div>
        {facts.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {facts.map((fact) => (
              <span
                key={fact}
                className="rounded-sm bg-fill px-1.5 py-0.5 text-caption text-muted"
              >
                {fact}
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-1 line-clamp-1 text-caption text-subtle">
          {integration.summary}
        </p>
      </div>
      <span className="pointer-events-none relative z-[2] hidden shrink-0 items-center gap-1 text-caption text-subtle transition-colors duration-200 group-hover:text-ink @[30rem]:inline-flex">
        Open
        <ArrowRight
          size={12}
          aria-hidden
          className="-translate-x-1 opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100"
        />
      </span>
    </article>
  )
}

function ConnectedEmpty({
  firstAvailable,
}: {
  firstAvailable: Integration | undefined
}) {
  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-dashed border-line-strong bg-surface px-5 py-5 @[36rem]:flex-row @[36rem]:items-center">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"
      >
        <ShareNetwork size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-item font-semibold text-ink">
          Nothing connected yet
        </p>
        <p className="mt-0.5 max-w-[62ch] text-meta text-muted">
          Connect a tool and the agent works where your team already does,
          inside the permissions you set here.
        </p>
      </div>
      {firstAvailable ? (
        <Link
          to="/settings"
          search={integrationSearch(firstAvailable)}
          className="shrink-0 self-start rounded text-meta font-medium text-brand underline decoration-line-strong underline-offset-4 hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @[36rem]:self-center"
        >
          Start with {firstAvailable.name}
        </Link>
      ) : null}
    </aside>
  )
}
