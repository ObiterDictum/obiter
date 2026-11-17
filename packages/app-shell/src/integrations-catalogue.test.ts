import { describe, expect, it } from 'bun:test'
import { INTEGRATION_MARKS } from './integration-marks'
import {
  INTEGRATION_GROUPS,
  INTEGRATIONS,
  type Integration,
  type IntegrationStatus,
} from './integrations-catalogue'
import {
  INTEGRATION_FILTERS,
  filterIntegrations,
  integrationById,
  integrationCounts,
  liveStatus,
} from './integrations-filter'

const GROUP_IDS = new Set(INTEGRATION_GROUPS.map((group) => group.id))
const statusOf = (integration: Integration): IntegrationStatus =>
  integration.id === 'buzz' ? 'connected' : integration.status

function ids(integrations: readonly Integration[]) {
  return integrations.map((integration) => integration.id)
}

describe('integrations catalogue', () => {
  it('puts every integration in one of the listed groups', () => {
    for (const integration of INTEGRATIONS) {
      expect(GROUP_IDS.has(integration.group)).toBe(true)
    }
    expect(INTEGRATIONS).toHaveLength(25)
  })

  it('gives each integration a unique addressable id', () => {
    expect(new Set(ids(INTEGRATIONS)).size).toBe(INTEGRATIONS.length)
    for (const integration of INTEGRATIONS) {
      expect(integrationById(integration.id)).toBe(integration)
    }
  })

  it('gives each integration exactly one real brand mark or a lettermark', () => {
    for (const integration of INTEGRATIONS) {
      const visual = integration.visual
      if (visual.kind === 'mark') {
        expect(INTEGRATION_MARKS[visual.key]).toBeDefined()
      } else {
        expect(visual.letters.length).toBeGreaterThan(0)
        expect(visual.letters.length).toBeLessThanOrEqual(3)
        expect(visual.hex).toMatch(/^#[0-9A-F]{6}$/u)
      }
    }
  })

  it('gives every integration capabilities with a title and an explanation', () => {
    for (const integration of INTEGRATIONS) {
      expect(integration.capabilities.length).toBeGreaterThanOrEqual(2)
      for (const capability of integration.capabilities) {
        expect(capability.title.length).toBeGreaterThan(0)
        expect(capability.description.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every integration planned except Buzz, which is the only one available', () => {
    for (const integration of INTEGRATIONS) {
      expect(integration.status).toBe(
        integration.id === 'buzz' ? 'available' : 'planned',
      )
    }
  })

  it('takes its live status only from Buzz and never invents a connection', () => {
    for (const integration of INTEGRATIONS) {
      expect(liveStatus(integration, 'connected')).toBe(
        integration.id === 'buzz' ? 'connected' : integration.status,
      )
    }
  })

  it('filters by status and by name, ignoring case and surrounding space', () => {
    expect(
      ids(
        filterIntegrations(INTEGRATIONS, {
          filter: 'connected',
          query: '',
          statusOf,
        }),
      ),
    ).toEqual(['buzz'])
    expect(
      ids(
        filterIntegrations(INTEGRATIONS, {
          filter: 'available',
          query: '',
          statusOf,
        }),
      ),
    ).toEqual([])
    expect(
      filterIntegrations(INTEGRATIONS, {
        filter: 'all',
        query: '  GOOGLE ',
        statusOf,
      }).map((integration) => integration.name),
    ).toEqual(['Google Chat', 'Google Calendar', 'Google Drive'])
    expect(
      ids(
        filterIntegrations(INTEGRATIONS, {
          filter: 'planned',
          query: 'slack',
          statusOf,
        }),
      ),
    ).toEqual(['slack'])
  })

  it('counts each status for the filter row', () => {
    expect(integrationCounts(INTEGRATIONS, statusOf)).toEqual({
      all: 25,
      connected: 1,
      available: 0,
      planned: 24,
      checking: 0,
    })
    expect(INTEGRATION_FILTERS.map((filter) => filter.id)).toEqual([
      'all',
      'connected',
      'available',
      'planned',
    ])
  })
})
