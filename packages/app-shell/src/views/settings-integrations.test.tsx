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
  MEMBER_ME,
  NPUB,
  STAFF_MEMBER_ME,
  buzzView,
  renderIntegrations,
} from './staff-buzz-test-support'
import { staffBuzzAgents } from '@obiter/contracts'

afterEach(() => {
  cleanup()
  mock.restore()
})

function card(name: string) {
  const heading = screen.getByRole('heading', { name, level: 4 })
  const item = heading.closest('li')
  if (!item) throw new Error(`Missing card for ${name}`)
  return within(item)
}

function filterRow() {
  return within(screen.getByRole('group', { name: 'Filter integrations' }))
}

function searchField() {
  return screen.getByRole('searchbox', { name: 'Search integrations' })
}

it('groups every integration and shows Buzz connected when the API reports an active key', async () => {
  renderIntegrations({
    buzz: buzzView({ me: { npub: NPUB, status: 'active' } }),
  })
  expect(await screen.findByRole('heading', { name: 'Team chat' })).toBeTruthy()
  for (const group of [
    'Email and calendar',
    'Documents and storage',
    'Practice management',
    'Signing',
    'Public sources',
  ]) {
    expect(screen.getByRole('heading', { name: group })).toBeTruthy()
  }
  await waitFor(() => expect(card('Buzz').getByText('Connected')).toBeTruthy())
  expect(card('Buzz').queryByRole('link', { name: 'Connect Buzz' })).toBeNull()
  expect(card('Slack').getByText('Planned')).toBeTruthy()
})

it('marks a planned integration and offers it no Connect action', async () => {
  renderIntegrations()
  await screen.findByRole('link', { name: 'Open Microsoft Outlook' })
  expect(card('Microsoft Outlook').getByText('Planned')).toBeTruthy()
  expect(
    card('Microsoft Outlook').queryByRole('link', {
      name: 'Connect Microsoft Outlook',
    }),
  ).toBeNull()
})

it('offers Connect for Buzz while its key is not linked and opens its detail', async () => {
  renderIntegrations({ buzz: buzzView() })
  const connect = await screen.findByRole('link', { name: 'Connect Buzz' })
  fireEvent.click(connect)
  expect(
    await screen.findByRole('heading', { name: 'Buzz', level: 2 }),
  ).toBeTruthy()
})

it('filters the directory by status', async () => {
  renderIntegrations({
    buzz: buzzView({ me: { npub: NPUB, status: 'active' } }),
  })
  await screen.findByRole('link', { name: 'Open Slack' })

  fireEvent.click(filterRow().getByRole('button', { name: 'Connected' }))
  expect(screen.getByRole('heading', { name: 'Buzz', level: 4 })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Slack', level: 4 })).toBeNull()

  fireEvent.click(filterRow().getByRole('button', { name: 'Planned' }))
  expect(screen.getByRole('heading', { name: 'Slack', level: 4 })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Buzz', level: 4 })).toBeNull()

  fireEvent.click(filterRow().getByRole('button', { name: 'Available' }))
  expect(screen.getByText('No integrations match this filter.')).toBeTruthy()
})

it('filters the directory by name', async () => {
  renderIntegrations()
  await screen.findByRole('link', { name: 'Open Slack' })

  fireEvent.change(searchField(), { target: { value: 'drive' } })
  expect(
    screen.getByRole('heading', { name: 'Google Drive', level: 4 }),
  ).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Slack', level: 4 })).toBeNull()

  fireEvent.change(searchField(), { target: { value: 'nothing here' } })
  expect(screen.getByText('Nothing matches “nothing here”.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show all integrations' }))
  expect(screen.getByRole('heading', { name: 'Slack', level: 4 })).toBeTruthy()
})

it('opens a planned integration from its card with every toggle disabled and the Planned header', async () => {
  renderIntegrations()
  fireEvent.click(
    await screen.findByRole('link', { name: 'Open Microsoft Outlook' }),
  )

  expect(
    await screen.findByRole('heading', { name: 'Microsoft Outlook', level: 2 }),
  ).toBeTruthy()
  expect(screen.getByText('Planned. Not available yet.')).toBeTruthy()
  expect(screen.getByText('What the agent can do')).toBeTruthy()
  expect(screen.getByText('Read mail it is given')).toBeTruthy()
  const switches = screen.getAllByRole('switch')
  expect(switches.length).toBe(4)
  for (const toggle of switches) {
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(toggle.getAttribute('tabindex')).toBe('-1')
  }
  expect(
    screen.getByText(
      'Every action the agent takes through this integration is recorded in the matter history.',
    ),
  ).toBeTruthy()
  expect(
    screen.getByText(
      'The subject, body and attachments of the threads you give it.',
    ),
  ).toBeTruthy()
})

it('features a connected integration above the groups with what is switched on', async () => {
  renderIntegrations({
    buzz: buzzView({
      me: {
        npub: NPUB,
        status: 'active',
        agents: staffBuzzAgents(['operations']),
      },
    }),
  })
  expect(
    await screen.findByRole('heading', { name: 'Connected', level: 3 }),
  ).toBeTruthy()
  expect(screen.getByText('Linked as npub1gutg…cky8')).toBeTruthy()
  expect(screen.getByText('5 agents')).toBeTruthy()
  expect(
    screen.getAllByRole('heading', { name: 'Buzz', level: 4 }),
  ).toHaveLength(1)
})

it('invites the first connection when nothing is connected yet', async () => {
  renderIntegrations({ buzz: buzzView() })
  expect(await screen.findByText('Nothing connected yet')).toBeTruthy()
  expect(
    (await screen.findByRole('link', { name: 'Start with Buzz' })).getAttribute(
      'href',
    ),
  ).toContain('integration=buzz')
})

it('keeps the connection prompt out of the planned filter', async () => {
  renderIntegrations({ buzz: buzzView() })
  await screen.findByRole('link', { name: 'Open Slack' })
  fireEvent.click(filterRow().getByRole('button', { name: 'Planned' }))
  expect(screen.queryByText('Nothing connected yet')).toBeNull()
})

it('says what a planned integration will bring when it ships', async () => {
  renderIntegrations()
  fireEvent.click(
    await screen.findByRole('link', { name: 'Open Microsoft Outlook' }),
  )
  expect(
    await screen.findByText(
      'Coming with Microsoft Outlook. These abilities switch on when it ships.',
    ),
  ).toBeTruthy()
})

it('shows the category, what it works with and the data it sends out', async () => {
  renderIntegrations()
  fireEvent.click(await screen.findByRole('link', { name: 'Open Slack' }))
  expect(await screen.findByText('Team chat')).toBeTruthy()
  expect(screen.getByText('Works with')).toBeTruthy()
  expect(screen.getByText('Research')).toBeTruthy()
  expect(screen.getByText('Leaves Obiter')).toBeTruthy()
  expect(screen.getByText('Message text and channel names')).toBeTruthy()
})

it('returns to the directory from the detail page', async () => {
  renderIntegrations()
  fireEvent.click(await screen.findByRole('link', { name: 'Open Slack' }))
  expect(
    await screen.findByRole('heading', { name: 'Slack', level: 2 }),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'All integrations' }))
  expect(
    await screen.findByRole('group', { name: 'Filter integrations' }),
  ).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Slack', level: 4 })).toBeTruthy()
})

it('offers nobody but an owner or admin the connect action or the Buzz blocks', async () => {
  renderIntegrations({ me: STAFF_MEMBER_ME, buzz: buzzView() })
  await screen.findByRole('link', { name: 'Open Buzz' })
  expect(screen.queryByRole('link', { name: 'Connect Buzz' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Open Buzz' }))
  expect(
    await screen.findByRole('heading', { name: 'Buzz', level: 2 }),
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Get an invite' })).toBeNull()
  expect(
    screen.getByText('Only an owner or admin can change this.'),
  ).toBeTruthy()
})

it('treats Buzz as planned for someone the Buzz API does not answer for', async () => {
  const { server } = renderIntegrations({ me: MEMBER_ME })
  await waitFor(() => expect(card('Buzz').getByText('Planned')).toBeTruthy())
  expect(
    server.requests.filter((request) => request.path.includes('/buzz')),
  ).toHaveLength(0)
})
