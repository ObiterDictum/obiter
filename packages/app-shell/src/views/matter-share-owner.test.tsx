import '@obiter/test-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MatterRecord, OrganisationMember } from '@obiter/contracts'
import { vi } from '../../../../scripts/test/vitest-compat'
import { MatterShareControls } from './matter-share-dialog'

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
  createdBy: 'usr_1',
  createdAt: '2026-11-02T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  deletedAt: null,
  deletedBy: null,
}

const members: OrganisationMember[] = []

let owner: {
  id: string
  name: string
  formerMember?: boolean
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  owner = { id: 'usr_1', name: 'Alex Morgan', formerMember: true }
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = String(input)
        if (path.endsWith('/shares'))
          return response({ ownerUserId: owner.id, owner, shares: [] })
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

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MatterShareControls
        matter={matter}
        organisationId="org"
        currentUserId="usr_2"
      />
    </QueryClientProvider>,
  )
}

describe('matter owner attribution', () => {
  it('names a former member as the owner rather than the generic placeholder', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    const ownerName = await screen.findByText('Alex Morgan')
    expect(ownerName.textContent).toBe('Alex Morgan (former member)')
    expect(screen.queryByText('The matter owner')).toBeNull()
  })

  it('resolves the owner from the member list until the share response carries a person', async () => {
    owner = { id: 'usr_1', name: 'Alex Morgan' }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    const ownerName = await screen.findByText('Alex Morgan')
    expect(ownerName.textContent).toBe('Alex Morgan')
  })

  it('says the owner is you only when the response names you as the owner', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(screen.getByText('Alex Morgan')).toBeTruthy())
    expect(screen.queryByText('(you)')).toBeNull()
  })
})
