import '@obiter/test-dom'
import { afterEach, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderUsage, section, tableWithHeaders } from './staff-usage-test-support'

afterEach(() => {
  cleanup()
  mock.restore()
})

it('renders charts for staff and keeps the tables behind toggles', async () => {
  const { client, requested } = renderUsage(true)
  expect(
    await screen.findByRole('img', {
      name: /Line chart of active users and new accounts/,
    }),
  ).toBeTruthy()
  expect(screen.getByText(/Obiter staff organisation is excluded/)).toBeTruthy()
  for (const label of [
    'Docs opened',
    'Docs saved',
    'Matters',
    'Redact',
    'Verify',
    'Agent',
    'Sources',
  ]) {
    expect(screen.getByRole('img', { name: `${label} per week` })).toBeTruthy()
  }
  expect(
    screen.queryByRole('region', { name: 'Weekly feature counts' }),
  ).toBeNull()
  const orgRegion = section('Usage by organisation')
  expect(
    within(orgRegion).getByRole('button', {
      name: 'Alpha Org: 20 active users',
    }),
  ).toBeTruthy()
  expect(
    within(orgRegion).queryByRole('columnheader', { name: 'Members' }),
  ).toBeNull()

  fireEvent.click(
    within(section('Feature use per week')).getByRole('button', {
      name: 'Show as table',
    }),
  )
  const weekly = tableWithHeaders(['Week', 'Agent'])
  expect(
    within(weekly).getByRole('columnheader', { name: 'Verify' }),
  ).toBeTruthy()

  fireEvent.click(
    within(orgRegion).getByRole('button', { name: 'Show as table' }),
  )
  const orgTable = tableWithHeaders(['Organisation', 'Members'])
  const bodyRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(bodyRows[0]).getByText('Alpha Org')).toBeTruthy()
  expect(bodyRows[0].textContent).toContain('org_al')
  expect(within(bodyRows[1]).getByText('Beta Org')).toBeTruthy()
  expect(within(bodyRows[2]).getByText('Alpha Org')).toBeTruthy()
  expect(bodyRows[2].textContent).toContain('zz_alp')
  expect(requested.some((path) => path.includes('weeks=12'))).toBe(true)

  const retention = tableWithHeaders(['Signup week', 'Week 0'])
  const firstCohort = within(retention).getByRole('cell', {
    name: 'Week 0: 100% of the cohort still active, 4 of 4',
  })
  expect(within(firstCohort).getByText('100%')).toBeTruthy()
  expect(within(firstCohort).getByText('4')).toBeTruthy()
  const secondCell = within(retention).getByRole('cell', {
    name: 'Week 1: 50% of the cohort still active, 2 of 4',
  })
  expect(within(secondCell).getByText('50%')).toBeTruthy()
  expect(within(secondCell).getByText('2')).toBeTruthy()
  const newestCohortCell = within(retention).getByRole('cell', {
    name: 'Week 0: 100% of the cohort still active, 3 of 3',
  })
  expect(within(newestCohortCell).getByText('3')).toBeTruthy()
  const cohortRows = within(retention).getAllByRole('row').slice(1)
  const newestCohort = within(cohortRows[1]).getAllByRole('cell')
  expect(newestCohort[newestCohort.length - 1].textContent).toBe('')
  client.clear()
})

it('re-sorts the organisation bars when the metric changes', async () => {
  const { client } = renderUsage(true)
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  const orgRegion = section('Usage by organisation')
  const barNames = () =>
    within(orgRegion)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-label')?.includes(':'))
      .map((button) => button.getAttribute('aria-label'))
  expect(barNames()[0]).toBe('Alpha Org: 20 active users')
  fireEvent.click(
    within(orgRegion).getByRole('button', { name: 'Verify runs' }),
  )
  expect(barNames()[0]).toBe('Alpha Org: 9 verify runs')
  expect(barNames()[1]).toBe('Alpha Org: 7 verify runs')
  expect(barNames()[2]).toBe('Beta Org: 2 verify runs')
  client.clear()
})

it('reads the weeks window from the url and ignores unsupported values', async () => {
  const first = renderUsage(true, '/staff/usage?weeks=4')
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  expect(first.requested.some((path) => path.includes('weeks=4'))).toBe(true)
  first.client.clear()
  cleanup()
  const second = renderUsage(true, '/staff/usage?weeks=7')
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  expect(second.requested.some((path) => path.includes('weeks=7'))).toBe(false)
  expect(second.requested.some((path) => path.includes('weeks=12'))).toBe(true)
  second.client.clear()
})

it('marks the sorted organisation column with aria-sort', async () => {
  const { client } = renderUsage(true)
  await screen.findByRole('img', {
    name: /Line chart of active users and new accounts/,
  })
  const orgRegion = section('Usage by organisation')
  fireEvent.click(
    within(orgRegion).getByRole('button', { name: 'Show as table' }),
  )
  const orgTable = tableWithHeaders(['Organisation', 'Members'])
  const activeHeader = within(orgTable).getByRole('columnheader', {
    name: 'Active',
  })
  expect(activeHeader.getAttribute('aria-sort')).toBe('descending')
  fireEvent.click(within(orgTable).getByRole('button', { name: 'Members' }))
  const membersHeader = within(orgTable).getByRole('columnheader', {
    name: /Members/,
  })
  expect(membersHeader.getAttribute('aria-sort')).toBe('descending')
  const bodyRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(bodyRows[0]).getByText('Alpha Org')).toBeTruthy()
  fireEvent.click(within(orgTable).getByRole('button', { name: 'Members' }))
  expect(membersHeader.getAttribute('aria-sort')).toBe('ascending')
  const sortedRows = within(orgTable).getAllByRole('row').slice(1)
  expect(within(sortedRows[0]).getByText('Beta Org')).toBeTruthy()
  client.clear()
})

it('shows the shell not-found page to a user who is not staff', async () => {
  const { client } = renderUsage(false)
  expect(await screen.findByText('We cannot find that page')).toBeTruthy()
  client.clear()
})
