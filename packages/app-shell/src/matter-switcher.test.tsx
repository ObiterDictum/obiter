import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import type { MatterRecord } from './matters'

const mocks = vi.hoisted(() => ({
  matters: [] as MatterRecord[],
}))

function matter(
  id: string,
  name: string,
  updatedAt: string,
  reference: string,
): MatterRecord {
  return {
    id,
    organisationId: 'org_1',
    name,
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: reference,
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt,
    deletedAt: null,
    deletedBy: null,
  }
}

const RECENT = [
  matter(
    'mtr_1',
    'Smith v Jones Lettings Ltd',
    '2026-10-09T09:00:00.000Z',
    'HP-2026-0412',
  ),
  matter(
    'mtr_2',
    'Ashcroft Probate',
    '2026-10-08T09:00:00.000Z',
    'HP-2026-0401',
  ),
  matter('mtr_3', 'Dunmore Conveyancing', '2026-10-07T09:00:00.000Z', ''),
]

const mattersModule = { ...(await import('./matters')) }
mock.module('./matters', () => ({
  ...mattersModule,
  useMattersList: () => ({ data: mocks.matters }),
}))

const { MatterSwitcher, matterChoices } = await import('./matter-switcher')

function LocationProbe() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return <p data-testid="pathname">{pathname}</p>
}

function renderSwitcher(matterId = 'mtr_1') {
  const rootRoute = createRootRoute()
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => (
          <>
            <MatterSwitcher
              matterId={matterId}
              matterName="Smith v Jones Lettings Ltd"
            />
            <LocationProbe />
          </>
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters',
        component: () => <LocationProbe />,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters/$matterId',
        component: () => <LocationProbe />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient: new QueryClient() },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('matter switcher', () => {
  it('lists recent matters newest first, with their client references', async () => {
    mocks.matters = RECENT
    renderSwitcher()
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch matter/ }),
    )
    const panel = await screen.findByLabelText('Switch matter')
    expect(panel.textContent).toContain('Ashcroft Probate')
    expect(panel.textContent).toContain('HP-2026-0401')
    expect(panel.textContent).toContain('All matters')
  })

  it('filters the list by matter name', async () => {
    mocks.matters = RECENT
    renderSwitcher()
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch matter/ }),
    )
    fireEvent.change(await screen.findByLabelText('Filter matters'), {
      target: { value: 'dunmore' },
    })
    const panel = screen.getByLabelText('Switch matter')
    expect(panel.textContent).toContain('Dunmore Conveyancing')
    expect(panel.textContent).not.toContain('Ashcroft Probate')
  })

  it('opens the matter you choose', async () => {
    mocks.matters = RECENT
    renderSwitcher()
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch matter/ }),
    )
    fireEvent.click(await screen.findByText('Ashcroft Probate'))
    await waitFor(() =>
      expect(screen.getByTestId('pathname').textContent).toBe('/matters/mtr_2'),
    )
  })
})

describe('matter choices', () => {
  it('caps the recent list at eight matters', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      matter(
        `mtr_${index}`,
        `Matter ${index}`,
        `2026-10-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        '',
      ),
    )
    expect(matterChoices(many, '', 'mtr_0')).toHaveLength(8)
  })

  it('keeps the current matter out of a filtered list', () => {
    expect(
      matterChoices(RECENT, 'smith', 'mtr_1').map((choice) => choice.id),
    ).toEqual([])
  })
})
