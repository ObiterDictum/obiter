import {
  INTEGRATIONS,
  type Integration,
  type IntegrationLifecycle,
  type IntegrationStatus,
} from './integrations-catalogue'

export type IntegrationFilter = 'all' | 'connected' | IntegrationLifecycle

export const INTEGRATION_FILTERS: readonly {
  id: IntegrationFilter
  label: string
}[] = [
  { id: 'all', label: 'All' },
  { id: 'connected', label: 'Connected' },
  { id: 'available', label: 'Available' },
  { id: 'planned', label: 'Planned' },
]

export function integrationById(id: string): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id)
}

export function liveStatus(
  integration: Integration,
  buzz: IntegrationStatus,
): IntegrationStatus {
  return integration.id === 'buzz' ? buzz : integration.status
}

export function filterIntegrations(
  integrations: readonly Integration[],
  {
    filter,
    query,
    statusOf,
  }: {
    filter: IntegrationFilter
    query: string
    statusOf: (integration: Integration) => IntegrationStatus
  },
): Integration[] {
  const term = query.trim().toLowerCase()
  return integrations.filter((integration) => {
    if (term && !integration.name.toLowerCase().includes(term)) return false
    return filter === 'all' || statusOf(integration) === filter
  })
}

export function integrationCounts(
  integrations: readonly Integration[],
  statusOf: (integration: Integration) => IntegrationStatus,
) {
  const counts = {
    all: integrations.length,
    connected: 0,
    available: 0,
    planned: 0,
    checking: 0,
  }
  for (const integration of integrations) counts[statusOf(integration)] += 1
  return counts
}
