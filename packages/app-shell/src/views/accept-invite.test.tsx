import '@obiter/test-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '../api'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  resendVerificationEmail: vi.fn(),
  session: null as {
    user: { id: string; email?: string }
    session: { id: string }
  } | null,
  isPending: false,
}))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const apiModule = { ...(await import('../api')) }
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const apiModuleKeys = Object.fromEntries(
  Object.keys(await import('../api')).map((key) => [key, undefined]),
)
mock.module('../api', () =>
  Object.assign(
    { ...apiModuleKeys },
    (() => {
      const actual = apiModule
      return { ...actual, apiFetch: mocks.apiFetch }
    })(),
  ),
)

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const authModuleKeys = Object.fromEntries(
  Object.keys(await import('../auth')).map((key) => [key, undefined]),
)
mock.module('../auth', () =>
  Object.assign(
    { ...authModuleKeys },
    (() => ({
      useAuth: () => ({
        session: mocks.session,
        isPending: mocks.isPending,
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        requestMagicLink: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
        resendVerificationEmail: mocks.resendVerificationEmail,
        signOut: vi.fn(),
      }),
    }))(),
  ),
)

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const tanstackReactRouterModuleKeys = Object.fromEntries(
  Object.keys(await import('@tanstack/react-router')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@tanstack/react-router', () =>
  Object.assign(
    { ...tanstackReactRouterModuleKeys },
    (() => ({
      useNavigate: () => mocks.navigate,
      useSearch: () => ({ token: 'invite-token' }),
      Link: ({
        children,
        to,
        search,
        className,
      }: {
        children: ReactNode
        to?: string
        search?: { token?: string }
        className?: string
      }) => {
        const href =
          typeof to === 'string'
            ? search?.token
              ? `${to}?token=${search.token}`
              : to
            : '#'
        return (
          <a href={href} className={className}>
            {children}
          </a>
        )
      },
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { AcceptInviteRouteView } = await import('./accept-invite')

const preview = {
  organisationName: 'North Chambers',
  invitedByName: 'Ada Owner',
}

function mockApi(options?: {
  preview?: typeof preview | ApiError
  accept?: unknown | ApiError
}) {
  const previewResult = options?.preview ?? preview
  mocks.apiFetch.mockImplementation(async (input: string) => {
    if (String(input).includes('/api/invites/preview')) {
      if (previewResult instanceof ApiError) throw previewResult
      return previewResult
    }
    if (options?.accept instanceof ApiError) throw options.accept
    return options?.accept ?? { organisationId: 'org_1', role: 'member' }
  })
}

function renderAccept() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <AcceptInviteRouteView />
    </QueryClientProvider>,
  )
}

describe('AcceptInviteRouteView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = null
    mocks.isPending = false
    mockApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('names the organisation and inviter before asking a signed-out user to sign up', async () => {
    renderAccept()
    await waitFor(() => {
      expect(screen.getByText('Join North Chambers.')).toBeTruthy()
      expect(
        screen.getByText('Ada Owner invited you to join this organisation.'),
      ).toBeTruthy()
    })
    expect(
      screen
        .getByRole('link', { name: /create an account/i })
        .getAttribute('href'),
    ).toBe('/sign-up?token=invite-token')
  })

  it('offers a sign-in link carrying the token to signed-out invitees', async () => {
    renderAccept()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy()
    })
    expect(
      screen.getByRole('link', { name: /sign in/i }).getAttribute('href'),
    ).toBe('/sign-in?token=invite-token')
    expect(screen.queryByText(/then return here/i)).toBeNull()
  })

  it('accepts the invite and routes home when signed in', async () => {
    mocks.session = {
      user: { id: 'usr_1', email: 'ada@obiter.dev' },
      session: { id: 'ses_1' },
    }
    mocks.navigate.mockResolvedValueOnce(undefined)

    renderAccept()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /accept invite/i }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: 'invite-token' }),
      })
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('shows the organisation-not-empty message and tells the user to revoke pending invites', async () => {
    mocks.session = { user: { id: 'usr_1' }, session: { id: 'ses_1' } }
    mockApi({
      accept: new ApiError(
        'organisation_not_empty',
        'Your current organisation still has matters, other members, or pending invites. Obiter will not move or delete that data, so this invite cannot be accepted. Revoke pending invites first.',
        409,
        'req_1',
      ),
    })

    renderAccept()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /accept invite/i }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(
          /still has matters, other members, or pending invites/i,
        ),
      ).toBeTruthy()
      expect(
        screen.getByText(/Revoke your own pending invites first/i),
      ).toBeTruthy()
    })
  })

  it.each([
    [
      'invite_expired',
      'This invite has expired.',
      /This invite has expired\. Ask the organisation to send a new one/,
    ],
    [
      'invite_revoked',
      'This invite has been revoked.',
      /This invite has been revoked\. Ask the organisation to send a new one/,
    ],
    [
      'invite_already_accepted',
      'This invite has already been accepted.',
      /This invite has already been accepted/,
    ],
    [
      'invite_not_found',
      'This invite was not found.',
      /This invite was not found\. Check the link from your email/,
    ],
  ] as const)(
    'renders a dedicated message for %s',
    async (code, message, expected) => {
      mockApi({
        preview: new ApiError(code, message, 404, 'req_preview'),
      })
      renderAccept()
      await waitFor(() => {
        expect(screen.getByText(expected)).toBeTruthy()
      })
      expect(
        screen.queryByRole('link', { name: /create an account/i }),
      ).toBeNull()
    },
  )

  it('renders a dedicated message when the invite is for a different email', async () => {
    mocks.session = { user: { id: 'usr_1' }, session: { id: 'ses_1' } }
    mockApi({
      accept: new ApiError(
        'forbidden',
        'This invite was sent to a different email address.',
        403,
        'req_3',
      ),
    })

    renderAccept()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /accept invite/i }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/sent to a different email address/i),
      ).toBeTruthy()
    })
  })

  it('offers a resend when the signed-in user is unverified', async () => {
    mocks.session = {
      user: { id: 'usr_1', email: 'ada@obiter.dev' },
      session: { id: 'ses_1' },
    }
    mockApi({
      accept: new ApiError(
        'forbidden',
        'Verify your email before accepting an invite.',
        403,
        'req_4',
      ),
    })
    mocks.resendVerificationEmail.mockResolvedValueOnce({ ok: true })

    renderAccept()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /accept invite/i }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email before accepting an invite/i),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )
    await waitFor(() => {
      expect(mocks.resendVerificationEmail).toHaveBeenCalledWith(
        'ada@obiter.dev',
        `${window.location.origin}/invites/accept?token=invite-token`,
      )
    })
  })
})
