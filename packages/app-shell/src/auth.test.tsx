// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import type { ReactNode } from 'react'
import { useAuth } from './auth'

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

const {
  signInEmail,
  signUpEmail,
  useSession,
  signOutFn,
  sendVerificationEmail,
  changePasswordFn,
  refetch,
} = mock

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

describe('useAuth — session refresh after credential auth', () => {
  it('refetches the session store after a successful email/password sign-in', async () => {
    signInEmail.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok', user: { id: 'usr_1' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'obiter-dev',
      })
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch the session when sign-in fails', async () => {
    signInEmail.mockResolvedValueOnce({
      error: { message: 'Invalid email or password.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'wrong',
      })
    })

    expect(refetch).not.toHaveBeenCalled()
  })

  it('refetches the session when sign-up establishes a session token', async () => {
    signUpEmail.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok', user: { id: 'usr_2' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.signUpWithEmail({
        name: 'Lex',
        email: 'lex@obiter.dev',
        password: 'password123',
      })
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch when sign-up only requires email verification', async () => {
    signUpEmail.mockResolvedValueOnce({
      error: null,
      data: { token: null, user: { id: 'usr_2' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.signUpWithEmail({
        name: 'New',
        email: 'new@obiter.dev',
        password: 'password123',
      })
    })

    expect(refetch).not.toHaveBeenCalled()
  })

  it('still returns ok when session refetch rejects after a successful sign-in', async () => {
    signInEmail.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok', user: { id: 'usr_1' } },
    })
    refetch.mockRejectedValueOnce(new Error('session GET failed'))

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'obiter-dev',
      })
    })

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ ok: true })
  })

  it('still returns ok when session refetch rejects after a session-establishing sign-up', async () => {
    signUpEmail.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok', user: { id: 'usr_2' } },
    })
    refetch.mockRejectedValueOnce(new Error('session GET failed'))

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signUpWithEmail({
        name: 'Lex',
        email: 'lex@obiter.dev',
        password: 'password123',
      })
    })

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ ok: true })
  })
})

describe('useAuth — sign-in success/failure', () => {
  it('returns ok on a successful email/password sign-in', async () => {
    signInEmail.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok', user: { id: 'usr_1' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'obiter-dev',
      })
    })

    expect(signInEmail).toHaveBeenCalledWith({
      email: 'lex@obiter.dev',
      password: 'obiter-dev',
    })
    expect(outcome).toEqual({ ok: true })
  })

  it('surfaces a real error message on a failed sign-in', async () => {
    signInEmail.mockResolvedValueOnce({
      error: { message: 'Invalid email or password.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'wrong',
      })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Invalid email or password.',
      code: undefined,
    })
  })

  it('falls back to a generic message when better-auth gives no message', async () => {
    signInEmail.mockResolvedValueOnce({ error: {}, data: null })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'x@y.z',
        password: 'p',
      })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Sign-in failed.',
      code: undefined,
    })
  })

  it('forwards EMAIL_NOT_VERIFIED so the sign-in screen can offer a resend', async () => {
    signInEmail.mockResolvedValueOnce({
      error: {
        message: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
      },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'lex@obiter.dev',
        password: 'obiter-dev',
      })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
    })
  })
})

describe('useAuth — registration with email verification', () => {
  it('reports verificationRequired when sign-up does not establish a session', async () => {
    // With requireEmailVerification enabled, better-auth returns { token: null, user }.
    signUpEmail.mockResolvedValueOnce({
      error: null,
      data: { token: null, user: { id: 'usr_2' } },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome:
      | { ok: boolean; message?: string; verificationRequired?: boolean }
      | undefined
    await act(async () => {
      outcome = await result.current.signUpWithEmail({
        name: 'New',
        email: 'new@obiter.dev',
        password: 'password123',
      })
    })

    expect(outcome).toMatchObject({ ok: true, verificationRequired: true })
    expect(outcome?.message).toMatch(/verify/i)
  })

  it('reports a sign-up failure', async () => {
    signUpEmail.mockResolvedValueOnce({
      error: { message: 'Email already in use.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signUpWithEmail({
        name: 'Dup',
        email: 'lex@obiter.dev',
        password: 'password123',
      })
    })

    expect(outcome).toEqual({ ok: false, message: 'Email already in use.' })
  })
})

describe('useAuth — session presence', () => {
  it('exposes the real session when better-auth reports one', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'usr_1' }, session: { id: 'ses_1' } },
      isPending: false,
      refetch,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await waitFor(() => {
      expect(result.current.session).not.toBeNull()
    })
    expect(result.current.session?.user.id).toBe('usr_1')
    expect(result.current.isPending).toBe(false)
  })

  it('reports null session when unauthenticated', () => {
    useSession.mockReturnValue({ data: null, isPending: false, refetch })
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })
    expect(result.current.session).toBeNull()
  })
})

describe('useAuth — signOut clears the current-user cache', () => {
  it('removes the cached /api/me so account-switching does not gate on the prior user', async () => {
    const client = new QueryClient()
    const cachedMe: MeResponse = {
      user: {
        id: 'usr_1',
        email: 'lex@obiter.dev',
        name: 'Lex',
        role: 'owner',
      },
      organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
    }
    client.setQueryData(['current-user'], cachedMe)
    expect(client.getQueryData(['current-user'])).toBeTruthy()

    signOutFn.mockResolvedValueOnce({})

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      await result.current.signOut()
    })

    expect(signOutFn).toHaveBeenCalledOnce()
    // The cache is cleared so a fresh sign-in never reads the previous user.
    expect(client.getQueryData(['current-user'])).toBeUndefined()
  })

  it('does not destroy stored drafts when the sign-out request fails', async () => {
    window.localStorage.setItem(
      'obiter.document-draft.1.org_1.usr_1.doc_1.tab_1',
      'keep me',
    )
    signOutFn.mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await expect(
      act(async () => {
        await result.current.signOut()
      }),
    ).rejects.toThrow('network')

    expect(
      window.localStorage.getItem(
        'obiter.document-draft.1.org_1.usr_1.doc_1.tab_1',
      ),
    ).toBe('keep me')
  })

  it('does not destroy stored drafts when sign-out returns an error result', async () => {
    window.localStorage.setItem(
      'obiter.document-draft.1.org_1.usr_1.doc_1.tab_1',
      'keep me',
    )
    signOutFn.mockResolvedValueOnce({ error: { message: 'unavailable' } })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await expect(
      act(async () => {
        await result.current.signOut()
      }),
    ).rejects.toThrow('unavailable')

    expect(
      window.localStorage.getItem(
        'obiter.document-draft.1.org_1.usr_1.doc_1.tab_1',
      ),
    ).toBe('keep me')
  })
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

describe('useAuth — resend verification email', () => {
  it('calls the better-auth client and reports success', async () => {
    sendVerificationEmail.mockResolvedValueOnce({ error: null, data: {} })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.resendVerificationEmail('lex@obiter.dev')
    })

    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'lex@obiter.dev',
    })
    expect(outcome).toEqual({
      ok: true,
      message: 'Check your email for a verification link.',
    })
  })

  it('reports a send failure', async () => {
    sendVerificationEmail.mockResolvedValueOnce({
      error: { message: 'Too many requests.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.resendVerificationEmail('lex@obiter.dev')
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Too many requests.',
    })
  })
})
