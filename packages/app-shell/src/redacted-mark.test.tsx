import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { RedactedMark } from './redacted-mark'
import type { VersionRedaction } from './documents'

const producedAt = '2026-10-29T10:00:00.000Z'

async function renderMark(redaction: VersionRedaction | null) {
  const rootRoute = createRootRoute()
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => (
          <>
            <span>ready</span>
            <RedactedMark redaction={redaction} producedAt={producedAt} />
          </>
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/redact/$runId',
        component: () => <div>Run page</div>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByText('ready')
}

afterEach(cleanup)

describe('RedactedMark', () => {
  it('marks the version and links to the run that produced it', async () => {
    await renderMark({
      runId: 'red_1',
      producedBy: 'A. Morgan',
      canOpen: true,
    })
    const link = await screen.findByRole('link', {
      name: 'Produced by Redact on 29 Oct 2026 by A. Morgan. Open the Redact run.',
    })
    expect(link.getAttribute('href')).toBe('/redact/red_1')
    expect(link.textContent).toBe('Redacted')
  })

  it('marks the version without a run link when the reader may not open the run', async () => {
    await renderMark({
      runId: 'red_1',
      producedBy: null,
      canOpen: false,
    })
    expect(screen.getByText('Redacted')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(
      screen.getByLabelText(
        'Produced by Redact on 29 Oct 2026 by another reviewer',
      ),
    ).toBeTruthy()
  })

  it('renders nothing for an ordinary version', async () => {
    await renderMark(null)
    expect(screen.queryByText('Redacted')).toBeNull()
  })
})
