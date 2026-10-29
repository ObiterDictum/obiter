import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import type { MatterRecord } from './matters'
import type { MatterOpenWork } from './views/matters-rows'
import { MatterOverview } from './views/matter-overview'

const at = '2026-10-01T09:00:00.000Z'

const matter: MatterRecord = {
  id: 'mtr_1',
  organisationId: 'org_1',
  name: 'Share purchase',
  description: null,
  primaryJurisdiction: 'England & Wales',
  secondaryJurisdictions: [],
  legalDomains: ['Corporate'],
  clientReference: 'REF-1',
  status: 'active',
  createdBy: 'usr_1',
  createdAt: at,
  updatedAt: '2026-10-26T09:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

function openWork(overrides: Partial<MatterOpenWork> = {}): MatterOpenWork {
  return {
    flaggedFindings: 1,
    reviewFindings: 2,
    redactionDecisions: 0,
    failed: 0,
    total: 3,
    ...overrides,
  }
}

function renderOverview(props: {
  openWork: MatterOpenWork | null
  openWorkUnavailable?: boolean
}) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <MatterOverview
          matter={matter}
          openWork={props.openWork}
          openWorkUnavailable={props.openWorkUnavailable ?? false}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('MatterOverview', () => {
  it('states the facts the matter record actually holds', async () => {
    renderOverview({ openWork: openWork() })

    const details = await screen.findByRole('region', {
      name: 'Matter details',
    })
    expect(within(details).getByText('England & Wales')).toBeTruthy()
    expect(within(details).getByText('Corporate')).toBeTruthy()
    expect(within(details).getByText('1 Oct 2026')).toBeTruthy()
    expect(within(details).getByText('26 Oct 2026')).toBeTruthy()
    expect(within(details).queryByText(/Client/)).toBeNull()
    expect(within(details).queryByText(/Fee earner/)).toBeNull()
  })

  it('counts flagged and need-review work in the words the document row uses', async () => {
    renderOverview({ openWork: openWork() })

    const openWorkRegion = await screen.findByRole('region', {
      name: 'Open work',
    })
    expect(within(openWorkRegion).getByText('1 flagged')).toBeTruthy()
    expect(within(openWorkRegion).getByText('2 need review')).toBeTruthy()
    expect(
      within(openWorkRegion).getByRole('link', { name: 'Review in Verify' }),
    ).toBeTruthy()
  })

  it('says a matter is clear rather than leaving the card empty', async () => {
    renderOverview({
      openWork: openWork({ flaggedFindings: 0, reviewFindings: 0, total: 0 }),
    })
    expect(
      await screen.findByText('Nothing is waiting on a person.'),
    ).toBeTruthy()
  })

  it('says open work is unreadable instead of claiming there is none', async () => {
    renderOverview({ openWork: null, openWorkUnavailable: true })
    expect(
      await screen.findByText(/Open work could not be loaded/),
    ).toBeTruthy()
    expect(screen.queryByText('Nothing is waiting on a person.')).toBeNull()
  })

  it('says it is reading open work while the runs load', async () => {
    renderOverview({ openWork: null })
    expect(await screen.findByText('Reading open work…')).toBeTruthy()
  })
})
