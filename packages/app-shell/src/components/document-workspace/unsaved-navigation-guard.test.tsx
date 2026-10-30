import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { UnsavedNavigationGuard } from './unsaved-navigation-guard'
import type { SaveState } from './use-document-save'

afterEach(cleanup)

function openEditor(initial: SaveState) {
  const root = createRootRoute({ component: Outlet })
  const editor = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => {
      const [state, setState] = useState(initial)
      return (
        <>
          <UnsavedNavigationGuard saveState={state} />
          <button onClick={() => setState({ status: 'saved' })}>Saved</button>
          <Link to="/other">Other</Link>
        </>
      )
    },
  })
  const other = createRoute({
    getParentRoute: () => root,
    path: '/other',
    component: () => <p>Other page</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([editor, other]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
}

it('asks before leaving while the save state is unsaved, and Stay keeps the editor', async () => {
  openEditor({ status: 'unsaved' })
  await screen.findByRole('link', { name: 'Other' })
  fireEvent.click(screen.getByRole('link', { name: 'Other' }))
  await screen.findByRole('heading', { name: 'Leave without saving?' })
  expect(screen.queryByText('Other page')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Leave without saving?' }),
    ).toBeNull(),
  )
  fireEvent.click(screen.getByRole('link', { name: 'Other' }))
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Leave without saving',
    }),
  )
  await screen.findByText('Other page')
})

it('asks before leaving while a save is in flight', async () => {
  openEditor({ status: 'saving' })
  fireEvent.click(await screen.findByRole('link', { name: 'Other' }))
  await screen.findByRole('heading', { name: 'Leave without saving?' })
})

it('leaves without a prompt once every change is saved', async () => {
  openEditor({ status: 'saved' })
  fireEvent.click(await screen.findByRole('link', { name: 'Other' }))
  await screen.findByText('Other page')
  expect(
    screen.queryByRole('heading', { name: 'Leave without saving?' }),
  ).toBeNull()
})

it('continues a blocked navigation when an in-flight save completes', async () => {
  openEditor({ status: 'saving' })
  const saved = await screen.findByRole('button', { name: 'Saved' })
  fireEvent.click(await screen.findByRole('link', { name: 'Other' }))
  await screen.findByRole('heading', { name: 'Leave without saving?' })
  fireEvent.click(saved)
  await screen.findByText('Other page')
  expect(screen.queryByRole('dialog')).toBeNull()
})
