import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { LineChart } from './staff-line-chart'
import { formatDate } from '../format'

const categories = ['2026-01-05', '2026-01-12', '2026-01-19']

const series = [
  {
    key: 'activeUsers',
    label: 'Active users',
    colour: 'var(--obiter-reviewer-1)',
    values: [10, 14, 12],
  },
  {
    key: 'newAccounts',
    label: 'New accounts',
    colour: 'var(--obiter-reviewer-4)',
    dashed: true,
    values: [2, 3, 1],
  },
]

function renderChart() {
  const { container } = render(
    <LineChart
      categories={categories}
      series={series}
      ariaLabel="Line chart of active users and new accounts per week"
    />,
  )
  const hitArea = container.querySelector('svg rect')
  if (!hitArea) throw new Error('chart hit area missing')
  hitArea.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 640,
    bottom: 240,
    width: 640,
    height: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return hitArea
}

afterEach(() => {
  cleanup()
})

it('snaps the crosshair to the nearest week and lists every series', () => {
  const hitArea = renderChart()
  fireEvent.pointerMove(hitArea, { clientX: 600 })
  const tooltip = screen.getByRole('tooltip')
  expect(within(tooltip).getByText(formatDate(categories[2]))).toBeTruthy()
  expect(within(tooltip).getByText('12')).toBeTruthy()
  expect(within(tooltip).getByText('1')).toBeTruthy()
  expect(within(tooltip).getByText('Active users')).toBeTruthy()
  expect(within(tooltip).getByText('New accounts')).toBeTruthy()
})

it('shows the first week when the pointer is at the left edge', () => {
  const hitArea = renderChart()
  fireEvent.pointerMove(hitArea, { clientX: 44 })
  const tooltip = screen.getByRole('tooltip')
  expect(within(tooltip).getByText(formatDate(categories[0]))).toBeTruthy()
  expect(within(tooltip).getByText('10')).toBeTruthy()
  expect(within(tooltip).getByText('2')).toBeTruthy()
})

it('hides the tooltip when the pointer leaves the plot', () => {
  const hitArea = renderChart()
  fireEvent.pointerMove(hitArea, { clientX: 300 })
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.pointerLeave(hitArea)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('keeps a hidden data table for screen readers and table views', () => {
  render(
    <LineChart
      categories={categories}
      series={series}
      ariaLabel="chart"
      table={
        <table>
          <caption>Weekly counts</caption>
          <tbody>
            <tr>
              <td>10</td>
            </tr>
          </tbody>
        </table>
      }
    />,
  )
  expect(screen.getByRole('table')).toBeTruthy()
})
