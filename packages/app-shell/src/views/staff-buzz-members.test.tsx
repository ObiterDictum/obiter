import '@obiter/test-dom'
import { afterEach, expect, it, mock } from 'bun:test'
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  NPUB,
  buzzMember,
  buzzView,
  renderBuzz,
} from './staff-buzz-test-support'

const MEMBERS = [
  buzzMember({
    userId: 'u_me',
    name: 'Karl Staff',
    npub: NPUB,
    status: 'active',
    roles: ['operations'],
  }),
  buzzMember({
    userId: 'u_sam',
    name: 'Sam Member',
    email: 'sam@synthetic.test',
    status: 'not_member',
  }),
  buzzMember({
    userId: 'u_ada',
    name: 'Ada Unlinked',
    email: 'ada@synthetic.test',
    status: 'unlinked',
  }),
  buzzMember({
    userId: 'u_rob',
    name: 'Rob Corpus',
    email: 'rob@synthetic.test',
    npub: NPUB,
    status: 'active',
    roles: ['corpus'],
  }),
]

const MANAGED = buzzView({
  me: { npub: NPUB, status: 'active' },
  canManage: true,
  members: MEMBERS,
})

function row(name: string) {
  const cell = screen.getByRole('cell', { name })
  const tr = cell.closest('tr')
  if (!tr) throw new Error(`Missing table row for ${name}`)
  return within(tr)
}

function checkbox(name: string) {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement
}

afterEach(() => {
  cleanup()
  mock.restore()
})

it('shows every member with plain status words and their roles to a manager', async () => {
  renderBuzz(MANAGED)
  expect(await screen.findByRole('table')).toBeTruthy()
  expect(row('Karl Staff').getByText('Active')).toBeTruthy()
  expect(row('Sam Member').getByText('Not joined yet')).toBeTruthy()
  expect(row('Ada Unlinked').getByText('Not linked')).toBeTruthy()
  expect(row('Rob Corpus').getByText('Active')).toBeTruthy()
  expect(checkbox('Operations for Karl Staff').checked).toBe(true)
  expect(checkbox('Corpus for Karl Staff').checked).toBe(false)
  expect(checkbox('Operations for Rob Corpus').checked).toBe(false)
  expect(checkbox('Corpus for Rob Corpus').checked).toBe(true)
})

it('sends the full role list when a role is toggled and shows the response', async () => {
  const { server } = renderBuzz(MANAGED)
  await screen.findByRole('table')
  fireEvent.click(checkbox('Corpus for Karl Staff'))
  await waitFor(() =>
    expect(
      server.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(1),
  )
  const put = server.requests.find((request) => request.method === 'PUT')
  expect(put?.path).toContain('/api/staff/buzz/members/u_me/roles')
  expect(put?.body).toEqual({ roles: ['operations', 'corpus'] })
  await waitFor(() =>
    expect(checkbox('Corpus for Karl Staff').checked).toBe(true),
  )
  expect(checkbox('Operations for Karl Staff').checked).toBe(true)
})

it('reverts the checkbox and shows the message when a role change fails', async () => {
  const { server } = renderBuzz(MANAGED)
  server.rolesError = {
    status: 400,
    message: 'You cannot change your own Buzz roles.',
  }
  await screen.findByRole('table')
  fireEvent.click(checkbox('Corpus for Karl Staff'))
  expect(checkbox('Corpus for Karl Staff').checked).toBe(true)
  expect(
    await screen.findByText('You cannot change your own Buzz roles.'),
  ).toBeTruthy()
  await waitFor(() =>
    expect(checkbox('Corpus for Karl Staff').checked).toBe(false),
  )
})

it('disables a row while its role change is in flight', async () => {
  const { server } = renderBuzz(MANAGED)
  await screen.findByRole('table')
  fireEvent.click(checkbox('Corpus for Karl Staff'))
  expect(checkbox('Corpus for Karl Staff').disabled).toBe(true)
  expect(checkbox('Operations for Karl Staff').disabled).toBe(true)
  expect(checkbox('Corpus for Rob Corpus').disabled).toBe(false)
  await waitFor(() =>
    expect(
      server.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(1),
  )
})
