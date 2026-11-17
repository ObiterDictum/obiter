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
import { shortNpub } from '../staff-buzz-data'
import { staffBuzzQueryOptions } from '../staff'
import {
  ConnectedStrip,
  type ConnectedIntegration,
} from './integration-connected'
import { IntegrationCard } from './integration-card'
import { IntegrationRule } from './integration-rule'
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
  const connected = INTEGRATIONS.filter(
    (integration) => statusOf(integration) === 'connected',
  ).map((integration): ConnectedIntegration => ({
    integration,
    facts: integration.id === 'buzz' ? buzzFacts(buzz) : [],
  }))
  const firstAvailable = canManage
    ? INTEGRATIONS.find((integration) => statusOf(integration) === 'available')
    : undefined

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
          connected={connected}
          firstAvailable={firstAvailable}
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

function buzzFacts(view: UseQueryResult<StaffBuzzResponse>) {
  const data = view.data
  if (!data || data.me.status !== 'active') return []
  const agents = data.me.agents.length
  return [
    ...(data.me.npub ? [`Linked as ${shortNpub(data.me.npub)}`] : []),
    agents === 1 ? '1 agent' : `${agents} agents`,
  ]
}

function IntegrationsDirectory({
  filter,
  query,
  onFilter,
  onQuery,
  statusOf,
  canConnect,
  connected,
  firstAvailable,
}: {
  filter: IntegrationFilter
  query: string
  onFilter: (filter: IntegrationFilter) => void
  onQuery: (query: string) => void
  statusOf: (integration: Integration) => IntegrationStatus
  canConnect: boolean
  connected: ConnectedIntegration[]
  firstAvailable: Integration | undefined
}) {
  const visible = filterIntegrations(INTEGRATIONS, {
    filter,
    query,
    statusOf,
  })
  const showConnected = query.trim() === '' && filter === 'all'
  const featured = new Set(
    showConnected ? connected.map((entry) => entry.integration.id) : [],
  )
  const grouped = visible.filter((integration) => !featured.has(integration.id))

  return (
    <div className="flex flex-col gap-8">
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

      {showConnected ? (
        <ConnectedStrip connected={connected} firstAvailable={firstAvailable} />
      ) : null}

      {grouped.length === 0 ? (
        <EmptyDirectory
          filter={filter}
          query={query}
          onClear={() => {
            onQuery('')
            onFilter('all')
          }}
        />
      ) : (
        <div className="flex flex-col gap-7">
          {INTEGRATION_GROUPS.map((group) => (
            <IntegrationGroupSection
              key={group.id}
              groupId={group.id}
              title={group.title}
              integrations={grouped.filter(
                (integration) => integration.group === group.id,
              )}
              statusOf={statusOf}
              canConnect={canConnect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IntegrationGroupSection({
  groupId,
  title,
  integrations,
  statusOf,
  canConnect,
}: {
  groupId: string
  title: string
  integrations: Integration[]
  statusOf: (integration: Integration) => IntegrationStatus
  canConnect: boolean
}) {
  if (integrations.length === 0) return null
  const headingId = `integration-group-${groupId}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <IntegrationRule
        id={headingId}
        label={title}
        count={integrations.length}
      />
      <ul className="grid grid-cols-1 items-stretch gap-3 @[28rem]:grid-cols-2 @[42rem]:grid-cols-3 @[52rem]:grid-cols-4">
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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-10 text-center">
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
