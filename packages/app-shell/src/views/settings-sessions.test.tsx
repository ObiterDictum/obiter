import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@obiter/ui'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

const authModule = { ...(await import('../auth')) }
mock.module('../auth', () => ({ ...authModule, useAuth: mocks.useAuth }))

const { SignedInDevices } = await import('./settings-sessions')

const SESSIONS = [
  {
    id: 'ses_current',
    token: 'tok_current',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z',
  },
  {
    id: 'ses_other',
    token: 'tok_other',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-11-04T09:00:00.000Z',
  },
]

const posts: { path: string; body: unknown }[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  posts.length = 0
  mocks.useAuth.mockReturnValue({
    session: {
      user: { id: 'usr_1', email: 'owner@obiter.dev' },
      session: { id: 'ses_current' },
    },
  })
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = String(input)
        if (path.endsWith('/api/auth/list-sessions') && !init?.method)
          return json(SESSIONS)
        if (path.endsWith('/api/auth/revoke-session')) {
          posts.push({ path, body: JSON.parse(String(init?.body)) })
          return json({})
        }
        if (path.endsWith('/api/auth/revoke-other-sessions')) {
          posts.push({ path, body: null })
          return json({})
        }
        return json(
          { error: { code: 'not_found', message: 'No.', requestId: 'r' } },
          404,
        )
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})

afterEach(() => {
  cleanup()
  mock.restore()
})

function renderDevices() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <SignedInDevices active />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return screen.findByRole('region', { name: 'Signed-in devices' })
}

describe('SignedInDevices', () => {
  it('lists each session with its device, sign-in and last-used times', async () => {
    const section = await renderDevices()
    expect(await within(section).findByText('Chrome on macOS')).toBeTruthy()
    expect(within(section).getByText('Firefox on Windows')).toBeTruthy()
    expect(within(section).getByText('This device')).toBeTruthy()
    expect(
      within(section).getAllByRole('button', { name: 'Sign out' }),
    ).toHaveLength(1)
  })

  it('revokes one other session by token', async () => {
    const section = await renderDevices()
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Sign out' }),
    )
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].path).toContain('/api/auth/revoke-session')
    expect(posts[0].body).toEqual({ token: 'tok_other' })
  })

  it('confirms before signing out every other device', async () => {
    const section = await renderDevices()
    fireEvent.click(
      await within(section).findByRole('button', {
        name: 'Sign out of all other devices',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(posts).toHaveLength(0)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Sign out other devices' }),
    )
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].path).toContain('/api/auth/revoke-other-sessions')
  })
})
