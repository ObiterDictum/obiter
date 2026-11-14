import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { TitleBar } from '../title-bar'
import { PagePanelProvider } from '../page-panel'
import { AgentWindowView } from './agent-window'
import { AgentContents } from './agent-contents'

function setup(path = '/agent', live = false, missing = false) {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input)
        if (url.endsWith('/api/agent-sessions'))
          return Response.json({
            sessions: [
              {
                id: 'old',
                title: 'Older question',
                updatedAt: '2026-11-10T10:00:00Z',
              },
              {
                id: 'ancient',
                title: 'Ancient question',
                updatedAt: '2026-10-01T10:00:00Z',
              },
              { id: 's1', title: 'Newest', updatedAt: '2026-11-14T10:00:00Z' },
            ],
          })
        if (url.endsWith('/api/agent-sessions/s1'))
          return missing
            ? Response.json(
                {
                  error: {
                    code: 'not_found',
                    message: 'Not found',
                    requestId: 'req_test',
                  },
                },
                { status: 404 },
              )
            : Response.json({
                session: {
                  title: 'Newest',
                  matterId: null,
                  activeRunId: live ? 'r1' : null,
                },
                runs: live
                  ? [{ id: 'r1', goal: 'A legal question', status: 'running' }]
                  : [],
              })
        return Response.json({ organisation: null })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren(
      ['/agent', '/agent/$sessionId'].map((path) =>
        createRoute({
          getParentRoute: () => root,
          path,
          component: () => (
            <>
              <TitleBar
                platform="web"
                focusMode={false}
                onExitFocusMode={() => {}}
                showSearch={false}
                chrome="sidebar"
              />
              <AgentContents pathname={router.state.location.pathname} />
              <PagePanelProvider
                panel={{
                  name: 'conversations',
                  expanded: false,
                  controls: 'conversations',
                  toggle: () => {},
                }}
              >
                <AgentWindowView />
              </PagePanelProvider>
            </>
          ),
        }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  mock.restore()
})
it('shows the law-only privacy boundary on the new conversation page', async () => {
  setup()
  expect(
    await screen.findByText(/Only you can see this conversation/),
  ).toBeTruthy()
})
it('orders conversations by updated time and marks the open conversation', async () => {
  setup('/agent/s1')
  const newest = await screen.findByRole('link', { name: /Newest/ })
  expect(newest.getAttribute('aria-current')).toBe('page')
  expect(
    newest.compareDocumentPosition(
      screen.getByRole('link', { name: /Older/ }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})
it('announces live research politely and disables the thread composer', async () => {
  setup('/agent/s1', true)
  const status = await screen.findByText('Researching your question…')
  expect(status.getAttribute('aria-live')).toBe('polite')
  expect(
    screen.getByRole('textbox', { name: 'Message' }).hasAttribute('disabled'),
  ).toBe(true)
})
it('shows the shell not-found state for an inaccessible conversation', async () => {
  setup('/agent/s1', false, true)
  expect(
    await screen.findByRole('heading', { name: /cannot find that page/i }),
  ).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('groups conversations by calendar day and the previous week', async () => {
  spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-14T12:00:00Z'))
  setup()
  expect(
    await screen.findByRole('heading', { name: 'Previous 7 days' }),
  ).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Older' })).toBeTruthy()
})

it('shows a slim conversation title and a collapsed conversations control', async () => {
  setup('/agent/s1')
  expect(await screen.findByRole('heading', { name: 'Newest' })).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Show conversations' }),
  ).toBeTruthy()
})

it('uses the conversation title as the last breadcrumb', async () => {
  setup('/agent/s1')
  const breadcrumb = await screen.findByRole('navigation', {
    name: 'Breadcrumb',
  })
  expect(await within(breadcrumb).findByText('Newest')).toBeTruthy()
})
