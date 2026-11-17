import '@obiter/test-dom'
import { afterEach, expect, it, mock } from 'bun:test'
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { staffBuzzAgents } from '@obiter/contracts'
import { shortNpub } from '../staff-buzz-data'
import {
  NPUB,
  buzzMember,
  buzzView,
  renderBuzz,
} from './staff-buzz-test-support'

afterEach(() => {
  cleanup()
  mock.restore()
})

it('hides every action when Buzz access is not set up', async () => {
  renderBuzz(buzzView({ available: false }))
  expect(await screen.findByText("Buzz access isn't set up yet.")).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Get an invite' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
  expect(screen.queryByLabelText('npub')).toBeNull()
  expect(screen.queryByText('Your agents')).toBeNull()
})

it('shows the invite URL, Copy and Open buttons, and its expiry', async () => {
  renderBuzz(buzzView())
  fireEvent.click(await screen.findByRole('button', { name: 'Get an invite' }))
  const link = (await screen.findByLabelText('Invite link')) as HTMLInputElement
  expect(link.value).toBe('https://buzz.example/invite/synthetic')
  expect(link.readOnly).toBe(true)
  expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
    'https://buzz.example/invite/synthetic',
  )
  expect(screen.getByText('Expires 20 Nov 2026')).toBeTruthy()
  expect(
    screen.getByText(
      'Open it with the Buzz app installed to join the Obiter workspace.',
    ),
  ).toBeTruthy()
})

it('says Buzz is unavailable when an invite answers 503', async () => {
  const { server } = renderBuzz(buzzView())
  server.inviteStatus = 503
  fireEvent.click(await screen.findByRole('button', { name: 'Get an invite' }))
  expect(
    await screen.findByText('Buzz is unavailable right now. Try again later.'),
  ).toBeTruthy()
})

it('refuses a value that is not an npub before sending it', async () => {
  const { server } = renderBuzz(buzzView())
  fireEvent.change(await screen.findByLabelText('npub'), {
    target: { value: 'nsec1abc' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Link' }))
  expect(
    await screen.findByText('Paste the npub from your Buzz profile.'),
  ).toBeTruthy()
  expect(server.requests.some((request) => request.method === 'PUT')).toBe(
    false,
  )
})

it('shows the message a rejected key gets from the server', async () => {
  const { server } = renderBuzz(buzzView())
  server.keyError = {
    status: 400,
    message: 'That npub is already linked to someone else.',
  }
  fireEvent.change(await screen.findByLabelText('npub'), {
    target: { value: NPUB },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Link' }))
  expect(
    await screen.findByText('That npub is already linked to someone else.'),
  ).toBeTruthy()
})

it('links the key with a PUT and shows the returned view without refetching', async () => {
  const { server } = renderBuzz(buzzView())
  fireEvent.change(await screen.findByLabelText('npub'), {
    target: { value: ` ${NPUB.toUpperCase()} ` },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Link' }))
  expect(
    await screen.findByText(
      "Your key is saved, but you haven't joined Buzz with your invite yet.",
    ),
  ).toBeTruthy()
  const put = server.requests.find((request) => request.method === 'PUT')
  expect(put?.path).toContain('/api/staff/buzz/key')
  expect(put?.body).toEqual({ npub: NPUB })
  expect(
    server.requests.filter((request) => request.method === 'GET'),
  ).toHaveLength(1)
})

it('offers Check again to someone whose key is saved but not joined', async () => {
  const { server } = renderBuzz(
    buzzView({ me: { npub: NPUB, status: 'not_member' } }),
  )
  expect(
    await screen.findByText(
      "Your key is saved, but you haven't joined Buzz with your invite yet.",
    ),
  ).toBeTruthy()
  expect(screen.queryByLabelText('npub')).toBeNull()
  expect(screen.getByRole('button', { name: 'Get an invite' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  await waitFor(() =>
    expect(
      server.requests.filter((request) => request.method === 'GET'),
    ).toHaveLength(2),
  )
})

it('shows the shortened npub and unlinks it only after confirmation', async () => {
  const { server } = renderBuzz(
    buzzView({ me: { npub: NPUB, status: 'active' } }),
  )
  expect(await screen.findByText(shortNpub(NPUB))).toBeTruthy()
  expect(screen.queryByText(NPUB)).toBeNull()
  expect(screen.getByRole('button', { name: `Copy ${NPUB}` })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Unlink Buzz key?')).toBeTruthy()
  expect(server.requests.some((request) => request.method === 'DELETE')).toBe(
    false,
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink key' }))
  await waitFor(() =>
    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(
      true,
    ),
  )
  expect(
    await screen.findByRole('button', { name: 'Get an invite' }),
  ).toBeTruthy()
})

it('lists each agent with its role and the approval note', async () => {
  renderBuzz(
    buzzView({
      me: {
        npub: NPUB,
        status: 'active',
        agents: staffBuzzAgents(['operations', 'corpus']),
      },
    }),
  )
  expect(await screen.findByText('Clerk')).toBeTruthy()
  expect(screen.getByText('routes requests')).toBeTruthy()
  expect(screen.getByText('Reporter')).toBeTruthy()
  expect(screen.getByText('UK law')).toBeTruthy()
  expect(screen.getByText('Scribe')).toBeTruthy()
  expect(screen.getByText('writing')).toBeTruthy()
  expect(screen.getByText('Examiner')).toBeTruthy()
  expect(screen.getByText('PR reviews')).toBeTruthy()
  expect(screen.getByText('Registrar (Operations role)')).toBeTruthy()
  expect(screen.getByText('ops status')).toBeTruthy()
  expect(screen.getByText('Archivist (Corpus role)')).toBeTruthy()
  expect(screen.getByText('Find Case Law notices')).toBeTruthy()
  expect(
    screen.getByText('Only Karl approves Archivist and Usher actions.'),
  ).toBeTruthy()
})

it('hides the manager table from someone who cannot manage', async () => {
  renderBuzz(
    buzzView({
      me: { npub: NPUB, status: 'active' },
      members: [
        buzzMember({
          userId: 'u_sam',
          name: 'Sam Member',
          status: 'not_member',
        }),
      ],
    }),
  )
  expect(await screen.findByText(shortNpub(NPUB))).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByText('Sam Member')).toBeNull()
})
