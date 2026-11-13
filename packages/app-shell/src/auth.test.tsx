import '@obiter/test-dom'
import { describe, expect, it, beforeEach, mock as bunMock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MeResponse } from '@obiter/contracts'
import type { ReactNode } from 'react'

const mock = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signOutFn: vi.fn(),
  sendVerificationEmail: vi.fn(),
  useSession: vi.fn(),
  refetch: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
}))

bunMock.module('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mock.useSession,
    signIn: { email: mock.signInEmail },
    signOut: mock.signOutFn,
    sendVerificationEmail: mock.sendVerificationEmail,
    twoFactor: {
      verifyTotp: mock.verifyTotp,
      verifyBackupCode: mock.verifyBackupCode,
    },
  }),
}))

bunMock.module('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({}),
  twoFactorClient: () => ({}),
}))

const { useAuth } = await import('./auth')

const {
  signInEmail,
  useSession,
  signOutFn,
  sendVerificationEmail,
  refetch,
  verifyTotp,
  verifyBackupCode,
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

  it('asks for the second factor when the server returns a two-factor redirect', async () => {
    signInEmail.mockResolvedValueOnce({
      error: null,
      data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({
        email: 'staff@obiter.dev',
        password: 'obiter-dev',
      })
    })

    expect(outcome).toEqual({ ok: true, twoFactor: true })
    expect(refetch).not.toHaveBeenCalled()
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

describe('useAuth — two-factor sign-in verification', () => {
  it('verifies a TOTP code and refreshes the session', async () => {
    verifyTotp.mockResolvedValueOnce({ error: null, data: { token: 'tok' } })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '123456' })
    })

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ ok: true })
  })

  it('verifies a backup code through the backup-code endpoint', async () => {
    verifyBackupCode.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok' },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.verifyTwoFactorSignIn({
        code: 'abcd-efgh',
        backupCode: true,
      })
    })

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'abcd-efgh' })
    expect(verifyTotp).not.toHaveBeenCalled()
  })

  it('explains a wrong code without exposing server detail', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: { message: 'Invalid code', code: 'INVALID_CODE' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '000000' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'That code is not correct. Check it and try again.',
      code: 'INVALID_CODE',
    })
    expect(refetch).not.toHaveBeenCalled()
  })

  it('tells the user to restart sign-in after too many attempts', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: {
        message: 'Too many attempts',
        code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '000000' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Too many incorrect attempts. Start sign-in again.',
      code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
    })
  })

  it('reports an expired challenge cookie', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: { message: 'Bad cookie', code: 'INVALID_TWO_FACTOR_COOKIE' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '123456' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Your sign-in timed out. Start again.',
      code: 'INVALID_TWO_FACTOR_COOKIE',
    })
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
      Promise.resolve(
        act(async () => {
          await result.current.signOut()
        }),
      ),
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
      Promise.resolve(
        act(async () => {
          await result.current.signOut()
        }),
      ),
    ).rejects.toThrow('unavailable')

    expect(
      window.localStorage.getItem(
        'obiter.document-draft.1.org_1.usr_1.doc_1.tab_1',
      ),
    ).toBe('keep me')
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
