import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router'
import type { MeResponse } from '@obiter/contracts'
import { ToastProvider } from '@obiter/ui'
import { CommandPaletteProvider, usePaletteActions } from './command-palette'
import { welcomeSteps } from './welcome-guide-steps'

const ME: MeResponse = {
  user: {
    id: 'usr_1',
    email: 'a@obiter.test',
    name: 'Ada Lane',
    role: 'owner',
  },
  organisation: { id: 'org_1', name: 'Lane Chambers', plan: 'private_beta' },
}

let me: MeResponse
const posts: string[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  posts.length = 0
  me = { ...ME, welcomeGuide: { seenAt: null } }
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (String(input).endsWith('/api/me')) return json(me)
        if (!String(input).endsWith('/api/me/welcome-guide'))
          return json({ error: { code: 'not_found', message: 'No.' } }, 404)
        if (init?.method === 'POST') {
          posts.push(String(input))
          return json({ seenAt: '2026-11-18T09:00:00.000Z' })
        }
        return json({})
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})

afterEach(() => {
  cleanup()
  mock.restore()
})

function Reopen() {
  const { welcomeGuide: open } = usePaletteActions()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <>
      <button type="button" onClick={open}>
        Reopen
      </button>
      <p data-testid="path">{pathname}</p>
    </>
  )
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['current-user'], me)
  const rootRoute = createRootRoute()
  const page = () => (
    <ToastProvider>
      <CommandPaletteProvider
        onToggleNav={() => {}}
        onToggleRightSlot={() => {}}
        onToggleFocusMode={() => {}}
      >
        <Reopen />
      </CommandPaletteProvider>
    </ToastProvider>
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      ['/', '/matters'].map((path) =>
        createRoute({ getParentRoute: () => rootRoute, path, component: page }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: ['/matters'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const dialog = () => screen.findByRole('dialog')

describe('welcome guide visibility', () => {
  it('opens by itself for a user the API has never shown it to, and records it as seen once closed', async () => {
    renderShell()
    await dialog()
    expect(screen.getByText('Step 1 of 8')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toHaveLength(1)
  })

  it('does not open by itself once the API records it as seen', async () => {
    me = { ...ME, welcomeGuide: { seenAt: '2026-11-01T09:00:00.000Z' } }
    renderShell()
    await screen.findByRole('button', { name: 'Reopen' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never opens by itself against an API without the welcome guide field, but still opens on request', async () => {
    me = ME
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    await dialog()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), {
      key: 'Escape',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toHaveLength(0)
  })

  it('reopening it on request does not record it again', async () => {
    me = { ...ME, welcomeGuide: { seenAt: '2026-11-01T09:00:00.000Z' } }
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toHaveLength(0)
  })
})

describe('welcome guide steps', () => {
  it('moves between steps with the arrow keys and the progress dots', async () => {
    renderShell()
    await dialog()
    const panel = screen.getByRole('button', { name: 'Next' })
    fireEvent.keyDown(panel, { key: 'ArrowRight' })
    expect(screen.getByText('Step 2 of 8')).toBeTruthy()
    fireEvent.keyDown(panel, { key: 'ArrowLeft' })
    fireEvent.keyDown(panel, { key: 'ArrowLeft' })
    expect(screen.getByText('Step 1 of 8')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Step 5: Verify citations and quotations',
      }),
    )
    expect(
      screen
        .getByRole('button', {
          name: 'Step 5: Verify citations and quotations',
        })
        .getAttribute('aria-current'),
    ).toBe('step')
  })

  it('ends with Get started, which closes the guide and goes Home', async () => {
    renderShell()
    await dialog()
    for (let step = 1; step < 8; step += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('path').textContent).toBe('/')
    expect(posts).toHaveLength(1)
  })

  it('labels shortcuts with ⌘ only on a Mac', () => {
    const text = (isMac: boolean) =>
      JSON.stringify(welcomeSteps(isMac).map((step) => step.body))
    expect(text(true)).toContain('⌘K')
    expect(text(false)).toContain('Ctrl+K')
    expect(text(false)).not.toContain('⌘')
  })
})
