import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from '../../../../scripts/test/vitest-compat'
import { AgentConnections } from './settings-agent-connections'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('removes a connection only after confirming its named dialog', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (init?.method === 'DELETE')
          return new Response(null, { status: 204 })
        return Response.json({
          connections: [
            {
              id: 'connection_1',
              name: 'Example Models',
              baseUrl: 'https://example.com/v1',
              keyLastFour: '1234',
              modelIds: ['example'],
            },
          ],
        })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <AgentConnections organisationId="org_1" />
    </QueryClientProvider>,
  )

  const remove = await screen.findByRole('button', { name: 'Remove' })
  remove.focus()
  fireEvent.click(remove)
  const dialog = screen.getByRole('dialog', { name: 'Remove Example Models?' })
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
  expect(dialog.textContent).toContain('until you choose another model')
  await waitFor(() => expect(document.activeElement).toBe(cancel))
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE'),
  ).toHaveLength(0)

  fireEvent.keyDown(cancel, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(remove))
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE'),
  ).toHaveLength(0)

  fireEvent.click(remove)
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent/connections/connection_1'),
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE'),
  ).toHaveLength(1)
}, 15_000)
