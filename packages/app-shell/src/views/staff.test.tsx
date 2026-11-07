import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import { Suspense } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@obiter/ui'
import { StaffRouteView } from './staff'

const group = {
  domain: 'synthetic.test',
  organisationNames: ['Synthetic Legal'],
  count: 1,
  categories: ['legal_professional'],
  countries: ['scotland'],
  oldestCreatedAt: '2026-11-01T10:00:00Z',
  requests: [
    {
      id: 'ar_synthetic',
      name: 'Synthetic applicant',
      email: 'applicant@synthetic.test',
      category: 'legal_professional',
      createdAt: '2026-11-01T10:00:00Z',
    },
  ],
}
afterEach(() => {
  cleanup()
  mock.restore()
})
for (const [label, target, decision] of [
  ['Approve organisation', 'domain', 'approve'],
  ['Decline', 'domain', 'decline'],
  ['Approve only this person', 'person', 'approve'],
  ['Decline', 'person', 'decline'],
] as const) {
  it(`confirms ${decision} for a ${target} and refreshes the queue`, async () => {
    const requests: unknown[] = []
    let queueReads = 0
    spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const path = String(input)
          let body: unknown = {}
          if (init?.method === 'POST') {
            requests.push(JSON.parse(String(init.body)))
            body = { count: 1 }
          } else if (path.endsWith('/api/staff/access')) {
            queueReads++
            body = { groups: queueReads === 1 ? [group] : [] }
          } else if (path.endsWith('/decisions')) body = { decisions: [] }
          else if (path.endsWith('/organisations')) body = { organisations: [] }
          return new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
          })
        },
        { preconnect: fetch.preconnect },
      ),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['current-user'], {
      isStaff: true,
      user: {
        id: 'synthetic',
        name: 'Synthetic reviewer',
        email: 'staff@synthetic.test',
        role: 'member',
      },
      organisation: null,
    })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Suspense fallback={<p>Loading review…</p>}>
            <StaffRouteView />
          </Suspense>
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Synthetic Legal')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: label })
    fireEvent.click(
      buttons[target === 'person' && decision === 'decline' ? 1 : 0],
    )
    const confirmation =
      decision === 'approve' ? 'Confirm approval' : 'Confirm decline'
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(requests).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: confirmation }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      target:
        target === 'domain'
          ? { kind: target, domain: group.domain }
          : { kind: target, requestId: 'ar_synthetic' },
      decision,
    })
    expect(
      await screen.findByText('No requests are waiting for review.'),
    ).toBeTruthy()
    expect(queueReads).toBeGreaterThan(1)
    client.clear()
  })
}
