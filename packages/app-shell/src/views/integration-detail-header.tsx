import type { ReactNode } from 'react'
import {
  integrationGroupTitle,
  integrationWorksWith,
  type Integration,
  type IntegrationStatus,
} from '../integrations-catalogue'
import { IntegrationStatusBadge } from './integration-status'
import { IntegrationTile, brandWash } from './integration-tile'

export function IntegrationDetailHeader({
  integration,
  status,
  action,
}: {
  integration: Integration
  status: IntegrationStatus
  action: ReactNode
}) {
  return (
    <header
      aria-labelledby="integration-name"
      className="relative overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-line"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: brandWash(integration, '16%') }}
      />
      <div className="relative flex flex-col gap-5 p-6 @[46rem]:p-7">
        <div className="flex flex-col gap-5 @[46rem]:flex-row @[46rem]:items-start @[46rem]:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <IntegrationTile integration={integration} size="detail" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 id="integration-name" className="text-page text-ink">
                  {integration.name}
                </h2>
                <IntegrationStatusBadge status={status} />
              </div>
              <p className="mt-1.5 max-w-[54ch] text-meta text-muted">
                {integration.summary}
              </p>
            </div>
          </div>
          <div className="shrink-0">{action}</div>
        </div>
        <FactsRow integration={integration} />
      </div>
    </header>
  )
}

function FactsRow({ integration }: { integration: Integration }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-caption">
      <div className="flex items-center gap-1.5">
        <dt className="text-subtle">Category</dt>
        <dd className="text-ink">{integrationGroupTitle(integration)}</dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt className="text-subtle">Works with</dt>
        <dd className="flex flex-wrap items-center gap-1">
          {integrationWorksWith(integration).map((tag) => (
            <span
              key={tag}
              className="rounded-sm bg-fill px-1.5 py-0.5 text-ink"
            >
              {tag}
            </span>
          ))}
        </dd>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <dt className="shrink-0 text-subtle">Leaves Obiter</dt>
        <dd className="line-clamp-1 max-w-[46ch] text-muted">
          {integration.leaves}
        </dd>
      </div>
    </dl>
  )
}
