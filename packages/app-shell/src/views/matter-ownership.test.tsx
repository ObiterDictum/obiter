import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MatterRecord, OrganisationMember } from '@obiter/contracts'
import { vi } from '../../../../scripts/test/vitest-compat'
import { RemoveMemberDialog } from './remove-member-dialog'
import { MatterTransferControls } from './matter-transfer-dialog'

const members = [
  { id: 'self', name: 'Alex', email: 'alex@example.test', role: 'owner' },
  { id: 'leaving', name: 'Sam', email: 'sam@example.test', role: 'member' },
  { id: 'next', name: 'Jo', email: 'jo@example.test', role: 'admin' },
] as const satisfies readonly OrganisationMember[]
const departing = members[1]
const matter: MatterRecord = {
  id: 'm1',
  organisationId: 'org',
  name: 'Synthetic matter',
  description: null,
  primaryJurisdiction: 'ew',
  secondaryJurisdictions: [],
  legalDomains: [],
  clientReference: '',
  status: 'active',
  createdBy: 'leaving',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  deletedBy: null,
}
let requests: Array<{ path: string; init?: RequestInit }>
let owned: Array<{ matterId: string; title: string }>
let rejectRemoval: boolean
let rejectTransfer: boolean

function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const option = await screen.findByRole('option', { name })
  fireEvent.focus(option)
  fireEvent.click(option)
}

beforeEach(() => {
  requests = []
  owned = [
    { matterId: 'm1', title: 'First matter' },
    { matterId: 'm2', title: 'Second matter' },
  ]
  rejectRemoval = false
  rejectTransfer = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const path = String(input)
        requests.push({ path, init })
        if (init?.method === 'DELETE') {
          if (rejectRemoval)
            return response(
              {
                error: {
                  code: 'conflict_detected',
                  message: 'Transfer the remaining matters.',
                  requestId: 'req_1',
                  uncoveredMatters: [
                    { matterId: 'm3', title: 'Newly assigned matter' },
                  ],
                },
              },
              409,
            )
          return new Response(null, { status: 204 })
        }
        if (path.endsWith('/transfer'))
          return rejectTransfer
            ? response(
                {
                  error: {
                    code: 'forbidden',
                    message: 'Only administrators can transfer this matter.',
                    requestId: 'req_2',
                  },
                },
                403,
              )
            : response({ matter: { ...matter, createdBy: 'next' } })
        if (path.endsWith('/matters')) return response({ matters: owned })
        if (path.endsWith('/members')) return response({ members })
        throw new Error(`Unexpected request ${path}`)
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('member removal with ownership transfers', () => {
  it('defaults to the actor and submits per-matter replacement choices in one request', async () => {
    const close = vi.fn()
    mount(
      <RemoveMemberDialog
        organisationId="org"
        member={departing}
        selfId="self"
        onClose={close}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Remove member' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false))
    expect(
      screen.getByRole('combobox', { name: 'Owner for First matter' })
        .textContent,
    ).toContain('Alex')
    await choose('Owner for First matter', 'Jo · jo@example.test')
    fireEvent.click(confirm)
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    const request = requests.find(
      (request) => request.init?.method === 'DELETE',
    )
    expect(request?.path).toEndWith('/api/organisations/org/members/leaving')
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      transfers: [
        { matterId: 'm1', newOwnerUserId: 'next' },
        { matterId: 'm2', newOwnerUserId: 'self' },
      ],
    })
  })

  it('blocks confirmation until every matter has an active replacement and supports transfer all to me', async () => {
    mount(
      <RemoveMemberDialog
        organisationId="org"
        member={departing}
        selfId="self"
        onClose={() => {}}
      />,
    )
    await screen.findByRole('combobox', { name: 'Owner for First matter' })
    await choose('Owner for First matter', 'Choose an owner')
    expect(
      screen
        .getByRole('button', { name: 'Remove member' })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Transfer all to me' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Remove member' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
  })

  it('shows uncovered matters from a 409 and requires an owner for the newly discovered matter', async () => {
    rejectRemoval = true
    const close = vi.fn()
    mount(
      <RemoveMemberDialog
        organisationId="org"
        member={departing}
        selfId="self"
        onClose={close}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Remove member' })
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false))
    fireEvent.click(confirm)
    await screen.findByText('Newly assigned matter')
    expect(confirm.hasAttribute('disabled')).toBe(true)
    expect(close).not.toHaveBeenCalled()
    rejectRemoval = false
    fireEvent.click(screen.getByRole('button', { name: 'Transfer all to me' }))
    fireEvent.click(confirm)
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(
      String(
        requests.filter((request) => request.init?.method === 'DELETE')[1]?.init
          ?.body,
      ),
    ).toContain('m3')
  })

  it('allows removal without transfers when the member owns no matters', async () => {
    owned = []
    const close = vi.fn()
    mount(
      <RemoveMemberDialog
        organisationId="org"
        member={departing}
        selfId="self"
        onClose={close}
      />,
    )
    await screen.findByText('This member owns no matters.')
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('blocks removal when the planned owned-matters endpoint is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(
        {
          error: {
            code: 'matter_not_found',
            message: 'Not available.',
            requestId: 'req_3',
          },
        },
        404,
      ),
    )
    mount(
      <RemoveMemberDialog
        organisationId="org"
        member={departing}
        selfId="self"
        onClose={() => {}}
      />,
    )
    await screen.findByText(
      'Could not load matters or active members. Removal is blocked.',
    )
    expect(
      screen
        .getByRole('button', { name: 'Remove member' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('matter ownership transfer', () => {
  it('requires a new owner and posts the confirmed transfer', async () => {
    mount(<MatterTransferControls matter={matter} user={members[0]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }))
    const confirm = screen.getByRole('button', { name: 'Confirm transfer' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await waitFor(() =>
      expect(
        requests.some((request) => request.path.endsWith('/members')),
      ).toBe(true),
    )
    await choose('New owner', 'Jo · jo@example.test')
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      requests.find((request) => request.path.endsWith('/transfer'))?.init,
    ).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ newOwnerUserId: 'next' }),
    })
  })

  it('keeps the dialog open and shows server refusal without claiming success', async () => {
    rejectTransfer = true
    mount(<MatterTransferControls matter={matter} user={members[0]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }))
    await choose('New owner', 'Jo · jo@example.test')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }))
    await screen.findByText('Only administrators can transfer this matter.')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('hides the action from ordinary members who did not create the matter', () => {
    mount(
      <MatterTransferControls
        matter={matter}
        user={{ ...departing, id: 'other' }}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Transfer ownership' }),
    ).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('offers the action to admins and the creator as well as organisation owners', () => {
    const view = mount(
      <MatterTransferControls matter={matter} user={members[2]} />,
    )
    expect(
      screen.getByRole('button', { name: 'Transfer ownership' }),
    ).toBeTruthy()
    view.unmount()
    mount(<MatterTransferControls matter={matter} user={departing} />)
    expect(
      screen.getByRole('button', { name: 'Transfer ownership' }),
    ).toBeTruthy()
  })
})
