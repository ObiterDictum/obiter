import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StaffErrors } from './staff-errors'
const original = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = original
})
it('renders error groups and opens recent samples with stack frames', async () => {
  const fingerprint = 'a'.repeat(64)
  globalThis.fetch = Object.assign(
    async (input: unknown) =>
      Response.json(
        String(input).includes(fingerprint)
          ? {
              samples: [
                {
                  source: 'web',
                  build: null,
                  kind: 'TypeError',
                  message: 'Failed',
                  frames: [
                    {
                      function: 'save',
                      file: 'editor.js',
                      line: 42,
                      column: 9,
                    },
                  ],
                  route: '/matters/:value',
                  userId: null,
                  organisationId: null,
                  time: '2026-11-14T12:00:00.000Z',
                  fingerprint,
                },
              ],
            }
          : {
              groups: [
                {
                  fingerprint,
                  kind: 'TypeError',
                  message: 'Failed',
                  count: 3,
                  users: 2,
                  firstSeen: '2026-11-14T12:00:00.000Z',
                  lastSeen: '2026-11-14T12:00:00.000Z',
                  build: null,
                  source: 'web',
                },
              ],
              daily: [{ day: '2026-11-14', count: 3 }],
            },
      ),
    { preconnect: original.preconnect },
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <StaffErrors />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(view.getByText('Failed')).toBeTruthy())
  fireEvent.click(view.getByRole('button', { name: 'TypeError' }))
  await waitFor(() =>
    expect(view.getByText('save (editor.js:42:9)')).toBeTruthy(),
  )
  client.clear()
})
