import { useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { Input } from '@obiter/ui'
import { MagnifyingGlass } from '@obiter/ui/icons'
import type { MeResponse, StaffBuzzResponse } from '@obiter/contracts'
import {
  INTEGRATION_GROUPS,
  INTEGRATIONS,
  type Integration,
  type IntegrationGroup,
  type IntegrationStatus,
} from '../integrations-catalogue'
import {
  INTEGRATION_FILTERS,
  filterIntegrations,
  integrationById,
  liveStatus,
  type IntegrationFilter,
} from '../integrations-filter'
import { SegmentedControl } from '../segmented-control'
import { staffBuzzQueryOptions } from '../staff'
import { IntegrationCard } from './integration-card'
import { IntegrationDetail } from './settings-integration-detail'

export function IntegrationsSection({ me }: { me: MeResponse }) {
  const integrationId = useRouterState({
    select: (state) =>
      new URLSearchParams(state.location.searchStr).get('integration'),
  })
  const [filter, setFilter] = useState<IntegrationFilter>('all')
  const [query, setQuery] = useState('')
  const buzz = useQuery({
    ...staffBuzzQueryOptions(),
    enabled: me.isStaff === true,
  })
  const organisation = me.organisation
  if (!organisation) return null

  const canManage = me.user.role === 'owner' || me.user.role === 'admin'
  const buzzStatus: IntegrationStatus =
    me.isStaff === true ? buzzIntegrationStatus(buzz) : 'planned'
  const statusOf = (integration: Integration) =>
    liveStatus(integration, buzzStatus)
  const selected = integrationId ? integrationById(integrationId) : undefined

  return (
    <section id="settings-integrations" aria-label="Integrations">
      {selected ? (
        <IntegrationDetail
          integration={selected}
          status={statusOf(selected)}
          organisationName={organisation.name}
          canManage={canManage}
          buzz={selected.id === 'buzz' ? buzz : undefined}
        />
      ) : (
        <IntegrationsDirectory
          filter={filter}
          query={query}
          onFilter={setFilter}
          onQuery={setQuery}
          statusOf={statusOf}
          canConnect={canManage}
        />
      )}
    </section>
  )
}

function buzzIntegrationStatus(
  view: UseQueryResult<StaffBuzzResponse>,
): IntegrationStatus {
  if (view.isPending) return 'checking'
  if (view.isError || !view.data.available) return 'planned'
  return view.data.me.status === 'active' ? 'connected' : 'available'
}

function IntegrationsDirectory({
  filter,
  query,
  onFilter,
  onQuery,
  statusOf,
  canConnect,
}: {
  filter: IntegrationFilter
  query: string
  onFilter: (filter: IntegrationFilter) => void
  onQuery: (query: string) => void
  statusOf: (integration: Integration) => IntegrationStatus
  canConnect: boolean
}) {
  const visible = filterIntegrations(INTEGRATIONS, {
    filter,
    query,
    statusOf,
  })

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-3 @[42rem]:flex-row @[42rem]:items-center @[42rem]:justify-between">
        <SegmentedControl
          label="Filter integrations"
          value={filter}
          options={INTEGRATION_FILTERS.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
          onChange={onFilter}
        />
        <div className="w-full @[42rem]:max-w-[17rem]">
          <Input
            type="search"
            aria-label="Search integrations"
            placeholder="Search integrations"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            trailing={<MagnifyingGlass size={16} aria-hidden />}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyDirectory
          filter={filter}
          query={query}
          onClear={() => {
            onQuery('')
            onFilter('all')
          }}
        />
      ) : (
        INTEGRATION_GROUPS.map((group) => (
          <IntegrationGroupSection
            key={group.id}
            group={group}
            integrations={visible.filter(
              (integration) => integration.group === group.id,
            )}
            statusOf={statusOf}
            canConnect={canConnect}
          />
        ))
      )}
    </div>
  )
}

function IntegrationGroupSection({
  group,
  integrations,
  statusOf,
  canConnect,
}: {
  group: IntegrationGroup
  integrations: Integration[]
  statusOf: (integration: Integration) => IntegrationStatus
  canConnect: boolean
}) {
  if (integrations.length === 0) return null
  return (
    <section
      aria-labelledby={`integration-group-${group.id}`}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <h3
          id={`integration-group-${group.id}`}
          className="text-meta font-medium text-ink"
        >
          {group.title}
        </h3>
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="text-caption tabular-nums text-subtle">
          {integrations.length}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-4 @[30rem]:grid-cols-2 @[46rem]:grid-cols-3 @[62rem]:grid-cols-4">
        {integrations.map((integration) => (
          <li key={integration.id} className="min-w-0">
            <IntegrationCard
              integration={integration}
              status={statusOf(integration)}
              canConnect={canConnect}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyDirectory({
  filter,
  query,
  onClear,
}: {
  filter: IntegrationFilter
  query: string
  onClear: () => void
}) {
  const message = query
    ? `Nothing matches “${query.trim()}”.`
    : filter === 'connected'
      ? 'No integrations are connected yet.'
      : 'No integrations match this filter.'
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="text-meta text-muted">{message}</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded text-caption text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Show all integrations
      </button>
    </div>
  )
}
