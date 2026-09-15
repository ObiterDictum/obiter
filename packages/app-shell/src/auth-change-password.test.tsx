// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAuth } from './auth'

/**
 * `useAuth().changePassword`. Split out of `auth.test.tsx` so the password
 * change has its own suite and neither file sits over the size ceiling. The
 * form that calls it is covered in `views/settings-security.test.tsx`.
 */
const mock = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOutFn: vi.fn(),
  sendVerificationEmail: vi.fn(),
  changePasswordFn: vi.fn(),
  useSession: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mock.useSession,
    signIn: { email: mock.signInEmail },
    signUp: { email: mock.signUpEmail },
    signOut: mock.signOutFn,
    sendVerificationEmail: mock.sendVerificationEmail,
    changePassword: mock.changePasswordFn,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({}),
}))

const { changePasswordFn, useSession, refetch } = mock

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  refetch.mockResolvedValue(undefined)
  useSession.mockReturnValue({ data: null, isPending: false, refetch })
})

describe('useAuth — change password', () => {
  it('revokes other sessions and refreshes the session store on success', async () => {
    changePasswordFn.mockResolvedValueOnce({
      error: null,
      data: { token: 'new-token', user: { id: 'usr_1' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.changePassword({
        currentPassword: 'current-secret',
        newPassword: 'replacement-secret',
      })
    })

    expect(changePasswordFn).toHaveBeenCalledWith({
      currentPassword: 'current-secret',
      newPassword: 'replacement-secret',
      // Other sessions are revoked so a stolen session stops working, which
      // matches revokeSessionsOnPasswordReset for the reset path.
      revokeOtherSessions: true,
    })
    expect(outcome).toEqual({ ok: true })
    expect(refetch).toHaveBeenCalled()
  })

  it('reports a rejected current password without echoing credential detail', async () => {
    changePasswordFn.mockResolvedValueOnce({
      error: { message: 'Invalid password', code: 'INVALID_PASSWORD' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.changePassword({
        currentPassword: 'wrong-secret',
        newPassword: 'replacement-secret',
      })
    })

    expect(outcome).toEqual({
      ok: false,
      code: 'INVALID_PASSWORD',
      message: 'Your current password is incorrect.',
    })
    expect(JSON.stringify(outcome)).not.toContain('wrong-secret')
    expect(JSON.stringify(outcome)).not.toContain('replacement-secret')
  })

  it('passes through a policy rejection and an unmapped failure', async () => {
    changePasswordFn.mockResolvedValueOnce({
      error: { message: 'Password too short', code: 'PASSWORD_TOO_SHORT' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let tooShort
    await act(async () => {
      tooShort = await result.current.changePassword({
        currentPassword: 'current-secret',
        newPassword: 'short',
      })
    })
    expect(tooShort).toEqual({
      ok: false,
      code: 'PASSWORD_TOO_SHORT',
      message: 'Password must be at least 8 characters.',
    })

    changePasswordFn.mockResolvedValueOnce({
      error: { message: 'Internal error', code: 'INTERNAL' },
      data: null,
    })

    let internal
    await act(async () => {
      internal = await result.current.changePassword({
        currentPassword: 'current-secret',
        newPassword: 'replacement-secret',
      })
    })
    expect(internal).toEqual({
      ok: false,
      code: 'INTERNAL',
      message: 'Could not change your password. Try again.',
    })
  })
})
